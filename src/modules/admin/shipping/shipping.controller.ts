import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { recordAuditLog } from "@/services/audit-log.service";
import { invalidateShippingCache } from "@/services/cache.service";
import {
  createShippingMethodSchema,
  shippingMethodIdParamsSchema,
  updateShippingMethodSchema,
} from "./shipping.schema";

export async function listShippingMethodsAdminHandler(_request: FastifyRequest, reply: FastifyReply) {
  const methods = await prisma.shippingMethod.findMany({
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });
  return reply.send({ methods });
}

/**
 * POST /api/admin/shipping
 *
 * El admin define aquí los tipos de envío que ve el comprador en el checkout
 * (nombre + coste). Los pedidos guardan un snapshot, así que editar o borrar
 * un método nunca altera pedidos ya realizados.
 */
export async function createShippingMethodHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createShippingMethodSchema.parse(request.body);

  const method = await prisma.shippingMethod.create({ data: input });
  await invalidateShippingCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Creó el método de envío "${method.name}" (${Number(method.price)} €)`,
    request,
    metadata: { shippingMethodId: method.id },
  });

  return reply.code(201).send({ method });
}

export async function updateShippingMethodHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = shippingMethodIdParamsSchema.parse(request.params);
  const input = updateShippingMethodSchema.parse(request.body);

  const existing = await prisma.shippingMethod.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Método de envío");

  const method = await prisma.shippingMethod.update({ where: { id }, data: input });
  await invalidateShippingCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Actualizó el método de envío "${method.name}" (${id})`,
    request,
    metadata: { shippingMethodId: id, changes: input },
  });

  return reply.send({ method });
}

export async function deleteShippingMethodHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = shippingMethodIdParamsSchema.parse(request.params);

  const existing = await prisma.shippingMethod.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Método de envío");

  // onDelete: SetNull en Order.shippingMethodId — los pedidos conservan su snapshot.
  await prisma.shippingMethod.delete({ where: { id } });
  await invalidateShippingCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Eliminó el método de envío "${existing.name}" (${id})`,
    request,
    metadata: { shippingMethodId: id },
  });

  return reply.code(204).send();
}
