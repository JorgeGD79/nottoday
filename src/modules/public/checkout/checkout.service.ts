import { Prisma, CartStatus, OrderStatus, ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";
import { quoteCart } from "@/services/pricing.service";
import { variantLabel } from "@/utils/slug";
import { assertDropPurchasable } from "@/services/drop.service";
import { createPaymentIntent, toStripeAmount } from "@/services/stripe.service";
import { invalidateCatalogCache } from "@/services/cache.service";
import { issueTicketsForOrder } from "@/services/ticket.service";
import { notifyOrder } from "@/services/order-notifications.service";
import { CheckoutInput } from "./checkout.schema";

interface LockedVariantRow {
  id: string;
  stockAvailable: number;
  stockReserved: number;
  size: string;
}

/**
 * POST /api/checkout — núcleo transaccional de la tienda.
 *
 * Bajo alta concurrencia (p. ej. el minuto de apertura de un drop), muchos
 * compradores pueden intentar comprar la última unidad de la misma talla al
 * mismo tiempo. Para evitar overselling:
 *
 *   1. Toda la operación ocurre dentro de una única transacción Prisma.
 *   2. Cada ProductVariant implicado se bloquea explícitamente con
 *      `SELECT ... FOR UPDATE` (row-level lock de Postgres) ANTES de leer su
 *      stock, así que una segunda transacción concurrente que quiera tocar
 *      la misma fila queda bloqueada hasta que la primera confirme o revierta.
 *   3. Las filas se bloquean siempre en el mismo orden (ID ascendente) entre
 *      todas las transacciones, para eliminar la posibilidad de deadlocks
 *      cruzados entre dos checkouts con carritos que comparten variantes.
 *   4. El importe se calcula con el motor de precios (pricing.service) dentro
 *      de la misma transacción: IVA, cupón revalidado en caliente y envío
 *      según país y peso. Nunca se confía en lo que calculó el frontend.
 */
export async function checkout(input: CheckoutInput) {
  const cart = await prisma.cart.findUnique({
    where: { id: input.cartId },
    include: {
      items: { include: { product: { include: { dropMeta: true } }, productVariant: true } },
      discountCode: true,
    },
  });

  if (!cart) throw AppError.notFound("Carrito");
  if (cart.items.length === 0) throw new AppError("El carrito está vacío", 422);
  if (cart.status === CartStatus.CONVERTIDO) throw AppError.conflict("Este carrito ya fue procesado");

  // Gate autoritativo: ningún item puede ser un drop cerrado ni una variante
  // retirada, aunque se haya saltado el frontend y el add-to-cart.
  for (const item of cart.items) {
    assertDropPurchasable(item.product);
    if (!item.productVariant.active) {
      throw new AppError(`"${item.product.name}" (${variantLabel(item.productVariant)}) ya no está a la venta`, 422);
    }
  }

  const requiresShipping = cart.items.some((i) => i.product.productType !== ProductType.TICKET_EVENTO);
  if (requiresShipping && !input.shippingAddress) {
    throw new AppError("Indica la dirección de envío", 422);
  }
  const country = input.shippingAddress?.country ?? input.billingCountry ?? null;

  const result = await prisma.$transaction(async (tx) => {
    // --- 1. Row locking: bloqueamos todas las variantes implicadas, en orden estable ---
    const lockedVariants = await lockVariants(tx, cart.items.map((i) => i.productVariantId));

    // --- 2. Verificación de stock real, ya con el lock en mano ---
    for (const item of cart.items) {
      const variant = lockedVariants.get(item.productVariantId)!;
      const available = variant.stockAvailable - variant.stockReserved;
      if (available < item.quantity) {
        throw new AppError(
          `Sin stock suficiente para ${item.product.name} (${variantLabel(item.productVariant)}): disponible ${available}`,
          409
        );
      }
    }

    // --- 3. Precio definitivo: IVA, cupón (revalidado en caliente) y envío por país/peso ---
    const quote = await quoteCart(tx, cart, {
      country,
      shippingMethodId: input.shippingMethodId,
      strict: true,
    });

    // --- 4. Reserva stock (no lo descuenta todavía) y crea el pedido + sus líneas ---
    // Incrementamos stockReserved en vez de descontar stockAvailable: la unidad
    // solo sale del inventario cuando el pago se confirma (markOrderAsPaid). Si el
    // pago falla o el pedido expira sin pagarse, la reserva se libera y el stock
    // vuelve a estar disponible. Así un pedido PENDIENTE nunca "quema" inventario.
    for (const item of cart.items) {
      await tx.productVariant.update({
        where: { id: item.productVariantId },
        data: { stockReserved: { increment: item.quantity } },
      });
    }

    const address = input.shippingAddress;
    const order = await tx.order.create({
      data: {
        email: input.email,
        subtotal: quote.subtotal,
        discountAmount: quote.discount?.amount ?? 0,
        total: quote.total,
        discountCodeId: quote.discountId,
        status: OrderStatus.PENDIENTE,
        taxAmount: quote.taxAmount,
        taxExempt: quote.taxExempt,
        shippingTaxRate: quote.shippingTaxRate,
        // Snapshot del envío: si el admin luego edita o borra el método,
        // el pedido conserva el nombre y el coste que realmente se cobraron.
        shippingMethodId: quote.shippingMethod?.id ?? null,
        shippingMethodName: quote.shippingMethod?.name ?? null,
        shippingCost: quote.shippingCost,
        shippingName: address?.name,
        shippingAddress: address?.address,
        shippingCity: address?.city,
        shippingPostalCode: address?.postalCode,
        shippingCountry: country,
        shippingPhone: address?.phone,
        items: {
          create: quote.lines.map((line) => ({
            productId: line.productId,
            productVariantId: line.productVariantId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
            discountAmount: line.discountAmount,
            variantLabel: line.variantLabel,
          })),
        },
      },
      include: { items: true },
    });

    await tx.cart.update({ where: { id: cart.id }, data: { status: CartStatus.CONVERTIDO } });

    return { order, total: quote.total };
  });

  // --- 5. Modo simulación (solo dev): saltamos Stripe por completo ---
  // Con CHECKOUT_SKIP_STRIPE=true no hay claves reales: marcamos un identificador
  // de pago ficticio y confirmamos el pedido como PAGADO (convierte la reserva en
  // venta) para poder recorrer todo el flujo —tracking, panel, fulfillment— sin
  // pasar por el Payment Element. env.ts impide activar esta flag en producción.
  if (env.CHECKOUT_SKIP_STRIPE) {
    await prisma.order.update({
      where: { id: result.order.id },
      data: { stripePaymentIntentId: `simulated_${result.order.id}` },
    });
    await markOrderAsPaid(result.order.id);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.order.id },
      include: { items: true },
    });
    return { order, clientSecret: null, simulated: true };
  }

  // --- 5b. Flujo real: creamos el PaymentIntent en Stripe ---
  // (una llamada de red no debe mantener abiertas las filas bloqueadas de Postgres).
  const paymentIntent = await createPaymentIntent({
    amount: toStripeAmount(result.total),
    currency: input.currency,
    orderId: result.order.id,
    receiptEmail: input.email,
  });

  const order = await prisma.order.update({
    where: { id: result.order.id },
    data: { stripePaymentIntentId: paymentIntent.id },
    include: { items: true },
  });

  await invalidateCatalogCache();

  return { order, clientSecret: paymentIntent.client_secret, simulated: false };
}

/**
 * Bloquea (SELECT ... FOR UPDATE) las variantes indicadas, siempre en orden de
 * ID ascendente para que dos transacciones concurrentes no se crucen en deadlock.
 */
export async function lockVariants(tx: Prisma.TransactionClient, ids: string[]) {
  const locked = new Map<string, LockedVariantRow>();
  for (const variantId of [...new Set(ids)].sort()) {
    const rows = await tx.$queryRaw<LockedVariantRow[]>`
      SELECT id, "stockAvailable", "stockReserved", size
      FROM "ProductVariant"
      WHERE id = ${variantId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw AppError.notFound("Variante de producto");
    locked.set(variantId, rows[0]);
  }
  return locked;
}

/**
 * Libera la reserva de stock de un pedido que finalmente no se pagó
 * (PaymentIntent cancelado, o expiración por TTL). Solo decrementa
 * stockReserved: como en un pedido PENDIENTE nunca se descontó stockAvailable,
 * las unidades vuelven automáticamente a estar disponibles.
 *
 * El cambio de estado es un UPDATE condicional (solo si sigue PENDIENTE), así
 * que dos llamadas concurrentes (webhook + barrido) nunca liberan dos veces.
 */
export async function releaseOrderStock(orderId: string, finalStatus: OrderStatus = OrderStatus.FALLIDO) {
  const released = await prisma.$transaction(async (tx) => {
    const claim = await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.PENDIENTE },
      data: { status: finalStatus },
    });
    if (claim.count === 0) return false;

    const items = await tx.orderItem.findMany({ where: { orderId } });
    for (const item of items) {
      await tx.productVariant.update({
        where: { id: item.productVariantId },
        data: { stockReserved: { decrement: item.quantity } },
      });
    }
    return true;
  });

  if (released) await invalidateCatalogCache();
  return released;
}

/**
 * Convierte un pedido en venta dentro de una transacción ya abierta: lo pasa a
 * PAGADO (solo si su estado actual está en `claimFrom`), descuenta el stock,
 * suma el uso del cupón y emite las entradas. Devuelve false si otro proceso
 * ya lo había movido de estado (webhook duplicado, barrido concurrente...).
 *
 * `fromReservation`: el stock estaba reservado (flujo normal) y hay que bajar
 * también stockReserved; en un pago tardío la reserva ya se había liberado.
 */
export async function commitSale(
  tx: Prisma.TransactionClient,
  orderId: string,
  claimFrom: OrderStatus[],
  fromReservation: boolean
) {
  const claim = await tx.order.updateMany({
    where: { id: orderId, status: { in: claimFrom } },
    data: { status: OrderStatus.PAGADO },
  });
  if (claim.count === 0) return false;

  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  for (const item of order.items) {
    await tx.productVariant.update({
      where: { id: item.productVariantId },
      data: {
        stockAvailable: { decrement: item.quantity },
        ...(fromReservation ? { stockReserved: { decrement: item.quantity } } : {}),
      },
    });
  }

  if (order.discountCodeId) {
    await tx.discount.update({
      where: { id: order.discountCodeId },
      data: { currentUses: { increment: 1 } },
    });
  }

  await issueTicketsForOrder(tx, orderId);
  return true;
}

/**
 * Confirma el pago de un pedido PENDIENTE: convierte la reserva en venta real,
 * emite las entradas y envía el email de confirmación. Devuelve true solo si
 * esta llamada fue la que hizo la transición (idempotente ante reintentos).
 */
export async function markOrderAsPaid(orderId: string) {
  const paid = await prisma.$transaction((tx) => commitSale(tx, orderId, [OrderStatus.PENDIENTE], true));

  if (paid) {
    await invalidateCatalogCache();
    await notifyOrder(orderId, "confirmation");
  }
  return paid;
}
