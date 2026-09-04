import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

const paramsSchema = z.object({ id: z.string().cuid() });
const querySchema = z.object({ email: z.string().email() });

/**
 * GET /api/orders/:id?email=...
 *
 * Seguimiento público de pedido. Sin cuentas de usuario, la "autenticación"
 * es el par id (cuid no adivinable) + email de compra: si no coinciden ambos,
 * 404 genérico sin revelar si el pedido existe. Se expone solo el subconjunto
 * necesario para el timeline — nunca la dirección postal completa ni el teléfono.
 */
export async function trackOrderHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = paramsSchema.parse(request.params);
  const { email } = querySchema.parse(request.query);

  const order = await prisma.order.findFirst({
    where: { id, email: { equals: email.trim(), mode: "insensitive" } },
    select: {
      id: true,
      status: true,
      fulfillmentStatus: true,
      trackingCode: true,
      createdAt: true,
      updatedAt: true,
      subtotal: true,
      discountAmount: true,
      shippingCost: true,
      total: true,
      shippingMethodName: true,
      shippingCity: true,
      shippingCountry: true,
      items: {
        select: {
          quantity: true,
          unitPrice: true,
          product: { select: { name: true, productType: true } },
          productVariant: { select: { size: true } },
        },
      },
    },
  });

  if (!order) throw AppError.notFound("Pedido");

  return reply.send({ order });
}
