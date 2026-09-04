import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { FulfillmentStatus, OrderStatus } from "@prisma/client";
import { recordAuditLog } from "@/services/audit-log.service";

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
