import { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { AppError } from "@/utils/AppError";
import { invalidateCatalogCache } from "@/services/cache.service";
import { notifyOrder } from "@/services/order-notifications.service";
import { isRealPaymentIntent, refundPaymentIntent, stripe } from "@/services/stripe.service";
import {
  commitSale,
  lockVariants,
  markOrderAsPaid,
  releaseOrderStock,
} from "@/modules/public/checkout/checkout.service";

// ============================================================================
// Ciclo de vida del pedido más allá del checkout: pagos que llegan tarde,
// cancelaciones de pedidos pendientes y reembolsos.
// ============================================================================

const LATE_PAYMENT_STATES: OrderStatus[] = [OrderStatus.CANCELADO, OrderStatus.FALLIDO];

/**
 * Stripe confirma un pago (webhook payment_intent.succeeded).
 *
 * Caso normal: el pedido está PENDIENTE y se confirma. Caso tardío: el pedido
 * ya se había cancelado o marcado fallido (caducó la reserva, o el primer
 * intento de tarjeta falló y el cliente reintentó) pero el cliente SÍ ha pagado.
 * Antes ese cobro se ignoraba en silencio; ahora se recupera o se reembolsa.
 */
export async function handleSucceededPayment(orderId: string) {
  if (await markOrderAsPaid(orderId)) return "paid" as const;

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
  if (order && LATE_PAYMENT_STATES.includes(order.status)) {
    return recoverLatePayment(orderId);
  }
  return "noop" as const;
}

/**
 * Pago recibido para un pedido ya cancelado/fallido: si todavía queda stock de
 * todas las líneas, se vuelve a tomar y el pedido pasa a PAGADO como si nada.
 * Si no queda, se reembolsa el importe completo y se avisa al cliente.
 */
async function recoverLatePayment(orderId: string) {
  const recovered = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || !LATE_PAYMENT_STATES.includes(order.status) || order.refundedAt) return null;

    const locked = await lockVariants(tx, order.items.map((i) => i.productVariantId));
    const needed = new Map<string, number>();
    for (const item of order.items) {
      needed.set(item.productVariantId, (needed.get(item.productVariantId) ?? 0) + item.quantity);
    }
    for (const [variantId, qty] of needed) {
      const v = locked.get(variantId)!;
      if (v.stockAvailable - v.stockReserved < qty) return false;
    }

    // La reserva ya se liberó al cancelar: se descuenta directamente del disponible.
    return commitSale(tx, orderId, LATE_PAYMENT_STATES, false);
  });

  if (recovered === null) return "noop" as const;

  if (recovered) {
    logger.warn({ orderId }, "Pago tardío recuperado: había stock y el pedido pasa a PAGADO");
    await invalidateCatalogCache();
    await notifyOrder(orderId, "confirmation");
    return "recovered" as const;
  }

  logger.warn({ orderId }, "Pago tardío sin stock disponible: se reembolsa automáticamente");
  await refundAndClose(orderId, { claimFrom: LATE_PAYMENT_STATES, restock: false, email: "late-refund" });
  return "refunded" as const;
}

/**
 * Reembolso total. Pasos, en este orden a propósito:
 *   1. Reclama el reembolso poniendo refundedAt (UPDATE condicional): un doble
 *      click o el webhook charge.refunded que llega a la vez no lo repiten.
 *   2. Llama a Stripe (con idempotencyKey). Si falla, se deshace el paso 1.
 *   3. Marca REEMBOLSADO y, si se pide, devuelve el stock.
 *
 * Los pedidos del modo demo (pago simulado) se reembolsan sin llamar a Stripe.
 */
async function refundAndClose(
  orderId: string,
  opts: { claimFrom: OrderStatus[]; restock: boolean; email: "refunded" | "late-refund" }
) {
  const claim = await prisma.order.updateMany({
    where: { id: orderId, status: { in: opts.claimFrom }, refundedAt: null },
    data: { refundedAt: new Date() },
  });
  if (claim.count === 0) {
    throw AppError.conflict("El pedido ya está reembolsado o en proceso de reembolso");
  }

  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });

  let stripeRefundId: string | null = null;
  if (isRealPaymentIntent(order.stripePaymentIntentId)) {
    try {
      const refund = await refundPaymentIntent(order.stripePaymentIntentId, `refund-${orderId}`, orderId);
      stripeRefundId = refund.id;
    } catch (err) {
      await prisma.order.update({ where: { id: orderId }, data: { refundedAt: null } });
      logger.error({ err, orderId }, "Stripe rechazó el reembolso");
      throw new AppError(`Stripe rechazó el reembolso: ${(err as Error).message}`, 502);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.REEMBOLSADO, stripeRefundId },
    });
    if (opts.restock) {
      for (const item of order.items) {
        await tx.productVariant.update({
          where: { id: item.productVariantId },
          data: { stockAvailable: { increment: item.quantity } },
        });
      }
    }
  });

  if (opts.restock) await invalidateCatalogCache();
  await notifyOrder(orderId, opts.email);
}

/**
 * Reembolso manual desde el panel (solo pedidos PAGADO). `restock` devuelve las
 * unidades al inventario (o el aforo, si son entradas): úsalo cuando la pieza
 * no llegó a salir o ha vuelto en buen estado.
 */
export async function refundOrder(orderId: string, opts: { restock: boolean }) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
  if (!order) throw AppError.notFound("Pedido");
  if (order.status !== OrderStatus.PAGADO) {
    throw new AppError("Solo se pueden reembolsar pedidos pagados", 422);
  }
  await refundAndClose(orderId, { claimFrom: [OrderStatus.PAGADO], restock: opts.restock, email: "refunded" });
}

/**
 * Reembolso hecho fuera de la web (dashboard de Stripe) → webhook charge.refunded.
 * Solo se refleja si es total y el pedido no tiene ya un reembolso nuestro en
 * curso. No devuelve stock (no sabemos si la mercancía ha vuelto): eso se
 * ajusta a mano en el producto.
 */
export async function markRefundedExternally(paymentIntentId: string, fullyRefunded: boolean) {
  const order = await prisma.order.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { id: true, status: true, refundedAt: true },
  });
  if (!order) return;
  if (!fullyRefunded) {
    logger.warn({ orderId: order.id }, "Reembolso parcial hecho en Stripe: el pedido sigue PAGADO, revísalo a mano");
    return;
  }

  const changed = await prisma.$transaction(async (tx) => {
    const claim = await tx.order.updateMany({
      where: { id: order.id, status: OrderStatus.PAGADO, refundedAt: null },
      data: { status: OrderStatus.REEMBOLSADO, refundedAt: new Date() },
    });
    if (claim.count === 0) return false;
    return true;
  });

  if (changed) await notifyOrder(order.id, "refunded");
}

/**
 * Cancela un pedido PENDIENTE (lo usan el barrido de caducados y el panel).
 *
 * El problema que resuelve: antes solo se cancelaba en nuestra BD y el
 * PaymentIntent seguía vivo en Stripe, así que el cliente podía pagar después
 * y quedarse sin pedido. Ahora:
 *   - Si el pago ya se completó en Stripe (el webhook no llegó o se retrasa),
 *     se confirma el pedido en lugar de cancelarlo.
 *   - Si está en "processing" (p. ej. SEPA), no se toca: se reintenta luego.
 *   - Si no, se cancela el PaymentIntent en Stripe ANTES de liberar el stock,
 *     de modo que ya no se pueda cobrar.
 */
export async function cancelPendingOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, stripePaymentIntentId: true },
  });
  if (!order) throw AppError.notFound("Pedido");
  if (order.status !== OrderStatus.PENDIENTE) return "not-pending" as const;

  const piId = order.stripePaymentIntentId;
  if (isRealPaymentIntent(piId)) {
    let intent = await stripe.paymentIntents.retrieve(piId);

    if (intent.status !== "succeeded" && intent.status !== "processing" && intent.status !== "canceled") {
      try {
        intent = await stripe.paymentIntents.cancel(piId);
      } catch (err) {
        // Puede fallar porque el pago se completó justo entre medias: releemos.
        intent = await stripe.paymentIntents.retrieve(piId);
        if (intent.status !== "succeeded" && intent.status !== "processing") throw err;
      }
    }

    if (intent.status === "succeeded") {
      await handleSucceededPayment(orderId);
      return "paid" as const;
    }
    if (intent.status === "processing") return "processing" as const;
  }

  await releaseOrderStock(orderId, OrderStatus.CANCELADO);
  return "cancelled" as const;
}
