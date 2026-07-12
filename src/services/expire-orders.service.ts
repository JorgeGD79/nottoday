import { prisma } from "@/lib/prisma";
import { OrderStatus } from "@prisma/client";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { releaseOrderStock } from "@/modules/public/checkout/checkout.service";

/**
 * Barrido de pedidos PENDIENTE caducados: cualquier pedido que lleva más de
 * PENDING_ORDER_TTL_MINUTES sin confirmarse (el cliente cerró la pestaña, el
 * pago quedó a medias y Stripe no emitió webhook, etc.) se cancela y su reserva
 * de stock se libera vía `releaseOrderStock`, devolviendo las unidades al
 * inventario disponible. Sin esto, un carrito abandonado en checkout bloquearía
 * stock indefinidamente (vector de agotamiento de inventario).
 */
export async function sweepExpiredPendingOrders() {
  const threshold = new Date(Date.now() - env.PENDING_ORDER_TTL_MINUTES * 60 * 1000);

  const expired = await prisma.order.findMany({
    where: { status: OrderStatus.PENDIENTE, createdAt: { lt: threshold } },
    select: { id: true },
  });

  let released = 0;
  for (const { id } of expired) {
    // releaseOrderStock es idempotente (solo actúa sobre pedidos PENDIENTE) y
    // corre su propia transacción por pedido, así un fallo puntual no aborta el resto.
    try {
      await releaseOrderStock(id, OrderStatus.CANCELADO);
      released += 1;
    } catch (err) {
      logger.error({ err, orderId: id }, "No se pudo expirar el pedido pendiente");
    }
  }

  logger.info({ count: released }, "Barrido de pedidos pendientes caducados completado");
  return released;
}
