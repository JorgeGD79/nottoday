import { Prisma, CartStatus, OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";
import { validateAndPriceDiscount } from "@/services/discount.service";
import { createPaymentIntent, toStripeAmount } from "@/services/stripe.service";
import { invalidateCatalogCache } from "@/services/cache.service";
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
 *   4. El descuento se revalida dentro de la misma transacción con los datos
 *      reales del carrito, nunca confiando en lo que ya se validó al añadirlo.
 */
export async function checkout(input: CheckoutInput) {
  const cart = await prisma.cart.findUnique({
    where: { id: input.cartId },
    include: { items: { include: { product: true, productVariant: true } }, discountCode: true },
  });

  if (!cart) throw AppError.notFound("Carrito");
  if (cart.items.length === 0) throw new AppError("El carrito está vacío", 422);
  if (cart.status === CartStatus.CONVERTIDO) throw AppError.conflict("Este carrito ya fue procesado");

  const subtotal = cart.items.reduce(
    (sum, item) => sum + Number(item.product.price) * item.quantity,
    0
  );

  // El método de envío lo define el admin; si lo desactivó, no se puede comprar con él.
  const shippingMethod = await prisma.shippingMethod.findUnique({
    where: { id: input.shippingMethodId },
  });
  if (!shippingMethod || !shippingMethod.active) {
    throw new AppError("El método de envío seleccionado no está disponible", 422);
  }

  const result = await prisma.$transaction(async (tx) => {
    // --- 1. Row locking: bloqueamos todas las variantes implicadas, en orden estable ---
    const variantIds = [...new Set(cart.items.map((i) => i.productVariantId))].sort();

    const lockedVariants = new Map<string, LockedVariantRow>();
    for (const variantId of variantIds) {
      const rows = await tx.$queryRaw<LockedVariantRow[]>`
        SELECT id, "stockAvailable", "stockReserved", size
        FROM "ProductVariant"
        WHERE id = ${variantId}
        FOR UPDATE
      `;
      if (rows.length === 0) throw AppError.notFound("Variante de producto");
      lockedVariants.set(variantId, rows[0]);
    }

    // --- 2. Verificación de stock real, ya con el lock en mano ---
    for (const item of cart.items) {
      const variant = lockedVariants.get(item.productVariantId)!;
      const available = variant.stockAvailable - variant.stockReserved;
      if (available < item.quantity) {
        throw new AppError(
          `Sin stock suficiente para la talla ${variant.size} (disponible: ${available})`,
          409
        );
      }
    }

    // --- 3. Descuento (si el carrito tiene uno aplicado), revalidado en caliente ---
    let discountAmount = 0;
    let discountId: string | null = null;
    let freeShipping = false;
    if (cart.discountCode) {
      const evaluation = await validateAndPriceDiscount(cart.discountCode.code, subtotal, tx);
      discountAmount = evaluation.discountAmount;
      discountId = evaluation.discountId;
      freeShipping = evaluation.freeShipping;
    }
    const shippingCost = freeShipping ? 0 : Number(shippingMethod.price);
    const total = Math.max(subtotal - discountAmount, 0) + shippingCost;

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

    const order = await tx.order.create({
      data: {
        email: input.email,
        subtotal,
        discountAmount,
        total,
        discountCodeId: discountId,
        status: OrderStatus.PENDIENTE,
        // Snapshot del envío: si el admin luego edita o borra el método,
        // el pedido conserva el nombre y el coste que realmente se cobraron.
        shippingMethodId: shippingMethod.id,
        shippingMethodName: shippingMethod.name,
        shippingCost,
        shippingName: input.shippingAddress.name,
        shippingAddress: input.shippingAddress.address,
        shippingCity: input.shippingAddress.city,
        shippingPostalCode: input.shippingAddress.postalCode,
        shippingCountry: input.shippingAddress.country,
        shippingPhone: input.shippingAddress.phone,
        items: {
          create: cart.items.map((item) => ({
            productId: item.productId,
            productVariantId: item.productVariantId,
            quantity: item.quantity,
            unitPrice: item.product.price,
          })),
        },
      },
      include: { items: true },
    });

    await tx.cart.update({ where: { id: cart.id }, data: { status: CartStatus.CONVERTIDO } });

    return { order, total };
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
 * Libera la reserva de stock de un pedido que finalmente no se pagó
 * (PaymentIntent fallido/cancelado, o expiración por TTL). Solo decrementa
 * stockReserved: como en un pedido PENDIENTE nunca se descontó stockAvailable,
 * las unidades vuelven automáticamente a estar disponibles.
 *
 * Se invoca desde el webhook de Stripe y desde el worker de expiración de pedidos.
 */
export async function releaseOrderStock(orderId: string, finalStatus: OrderStatus = OrderStatus.FALLIDO) {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.status !== OrderStatus.PENDIENTE) return;

    for (const item of order.items) {
      await tx.productVariant.update({
        where: { id: item.productVariantId },
        data: { stockReserved: { decrement: item.quantity } },
      });
    }

    await tx.order.update({ where: { id: orderId }, data: { status: finalStatus } });
  });

  await invalidateCatalogCache();
}

/**
 * Confirma el pago: convierte la reserva en venta real. Por cada línea baja
 * tanto stockReserved (deja de estar reservado) como stockAvailable (sale del
 * inventario de verdad), todo dentro de la misma transacción que marca PAGADO.
 */
export async function markOrderAsPaid(orderId: string) {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.status !== OrderStatus.PENDIENTE) return;

    for (const item of order.items) {
      await tx.productVariant.update({
        where: { id: item.productVariantId },
        data: {
          stockReserved: { decrement: item.quantity },
          stockAvailable: { decrement: item.quantity },
        },
      });
    }

    await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.PAGADO } });

    if (order.discountCodeId) {
      await tx.discount.update({
        where: { id: order.discountCodeId },
        data: { currentUses: { increment: 1 } },
      });
    }
  });

  await invalidateCatalogCache();
}
