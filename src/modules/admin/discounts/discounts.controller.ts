import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { recordAuditLog } from "@/services/audit-log.service";
import {
  createDiscountSchema,
  discountIdParamsSchema,
  updateDiscountSchema,
} from "./discounts.schema";

export async function listDiscountsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const discounts = await prisma.discount.findMany({ orderBy: { createdAt: "desc" } });
  return reply.send({ discounts });
}

export async function createDiscountHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createDiscountSchema.parse(request.body);

  const existing = await prisma.discount.findUnique({ where: { code: input.code } });
  if (existing) {
    throw AppError.conflict(`Ya existe un cupón con el código ${input.code}`);
  }

  const discount = await prisma.discount.create({ data: input });

  await recordAuditLog({
    userId: request.user.id,
    action: `Creó el cupón "${discount.code}" (${discount.type})`,
    request,
    metadata: { discountId: discount.id },
  });

  return reply.code(201).send({ discount });
}

export async function updateDiscountHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = discountIdParamsSchema.parse(request.params);
  const input = updateDiscountSchema.parse(request.body);

  const existing = await prisma.discount.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Cupón");

  const discount = await prisma.discount.update({ where: { id }, data: input });

  await recordAuditLog({
    userId: request.user.id,
    action: `Actualizó el cupón "${discount.code}"`,
    request,
    metadata: { discountId: id, changes: input },
  });

  return reply.send({ discount });
}

export async function deleteDiscountHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = discountIdParamsSchema.parse(request.params);

  const existing = await prisma.discount.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Cupón");

  await prisma.discount.delete({ where: { id } });

  await recordAuditLog({
    userId: request.user.id,
    action: `Eliminó el cupón "${existing.code}"`,
    request,
    metadata: { discountId: id },
  });

  return reply.code(204).send();
}
