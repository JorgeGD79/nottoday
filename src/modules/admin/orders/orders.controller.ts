import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { FulfillmentStatus, OrderStatus } from "@prisma/client";
import { recordAuditLog } from "@/services/audit-log.service";
import { notifyOrder } from "@/services/order-notifications.service";
import { cancelPendingOrder, refundOrder } from "@/services/order-lifecycle.service";

const listQuerySchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  fulfillment: z.nativeEnum(FulfillmentStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

/**
 * GET /api/admin/orders — pedidos del checkout, con líneas, envío y dirección.
 * Es la bandeja logística: de aquí sale qué hay que empaquetar y a dónde.
 */
export async function listOrdersHandler(request: FastifyRequest, reply: FastifyReply) {
  const { status, fulfillment, page, pageSize } = listQuerySchema.parse(request.query);
  const where = {
    ...(status ? { status } : {}),
    ...(fulfillment ? { fulfillmentStatus: fulfillment } : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        items: {
          include: {
            product: { select: { name: true, productType: true } },
            productVariant: { select: { size: true } },
          },
        },
        discountCode: { select: { code: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return reply.send({
    orders,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

const fulfillmentSchema = z.object({
  fulfillmentStatus: z.nativeEnum(FulfillmentStatus),
  trackingCode: z.string().max(120).optional(),
});
const orderIdParamsSchema = z.object({ id: z.string().cuid() });

/**
 * PUT /api/admin/orders/:id/fulfillment
 *
 * Mueve el pedido por el flujo logístico (PENDIENTE -> ENVIADO -> ENTREGADO).
 * Solo se puede marcar como enviado/entregado un pedido ya PAGADO: enviar
 * un pedido sin cobrar es un error operativo, no un estado válido.
 */
export async function updateFulfillmentHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = orderIdParamsSchema.parse(request.params);
  const input = fulfillmentSchema.parse(request.body);

  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Pedido");

  if (input.fulfillmentStatus !== FulfillmentStatus.PENDIENTE && existing.status !== OrderStatus.PAGADO) {
    throw new AppError("Solo se pueden enviar pedidos con el pago confirmado", 422);
  }

  const order = await prisma.order.update({
    where: { id },
    data: {
      fulfillmentStatus: input.fulfillmentStatus,
      trackingCode: input.trackingCode ?? existing.trackingCode,
    },
  });

  // Aviso al cliente solo en la transición a ENVIADO (no al re-guardar el tracking).
  if (input.fulfillmentStatus === FulfillmentStatus.ENVIADO && existing.fulfillmentStatus !== FulfillmentStatus.ENVIADO) {
    await notifyOrder(id, "shipped");
  }

  await recordAuditLog({
    userId: request.user.id,
    action: `Marcó el pedido ${id} como ${input.fulfillmentStatus}${input.trackingCode ? ` (tracking ${input.trackingCode})` : ""}`,
    request,
    metadata: {
      orderId: id,
      previousFulfillment: existing.fulfillmentStatus,
      newFulfillment: input.fulfillmentStatus,
      trackingCode: input.trackingCode,
    },
  });

  return reply.send({ order });
}

const refundSchema = z.object({
  // Devolver las unidades al inventario (o el aforo, si son entradas).
  restock: z.boolean().default(false),
});

/**
 * POST /api/admin/orders/:id/refund — reembolso total de un pedido PAGADO
 * (Stripe, o sin llamar a Stripe si el pago fue simulado en modo demo).
 * Avisa al cliente por email.
 */
export async function refundOrderHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = orderIdParamsSchema.parse(request.params);
  const { restock } = refundSchema.parse(request.body ?? {});

  await refundOrder(id, { restock });

  await recordAuditLog({
    userId: request.user.id,
    action: `Reembolsó el pedido ${id}${restock ? " (stock devuelto)" : ""}`,
    request,
    metadata: { orderId: id, restock },
  });

  const order = await prisma.order.findUniqueOrThrow({ where: { id } });
  return reply.send({ order });
}

/**
 * POST /api/admin/orders/:id/cancel — cancela un pedido PENDIENTE: cancela el
 * PaymentIntent en Stripe y libera la reserva de stock. Si resulta que el
 * cliente sí había pagado, el pedido se confirma en vez de cancelarse.
 */
export async function cancelOrderHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = orderIdParamsSchema.parse(request.params);

  const outcome = await cancelPendingOrder(id);
  if (outcome === "not-pending") {
    throw new AppError("Solo se pueden cancelar pedidos pendientes de pago. Para uno pagado, usa el reembolso.", 422);
  }
  if (outcome === "processing") {
    throw new AppError("El pago está en proceso en Stripe; espera a que se resuelva antes de cancelar.", 409);
  }

  await recordAuditLog({
    userId: request.user.id,
    action: outcome === "paid" ? `Intentó cancelar el pedido ${id}, pero ya estaba pagado en Stripe (confirmado)` : `Canceló el pedido ${id}`,
    request,
    metadata: { orderId: id, outcome },
  });

  const order = await prisma.order.findUniqueOrThrow({ where: { id } });
  return reply.send({ order, outcome });
}
