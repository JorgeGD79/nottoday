import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { ProductStatus, ProductType } from "@prisma/client";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";

/**
 * GET /api/tickets
 *
 * Tickets de evento: son Product (productType TICKET_EVENTO, status ACTIVO)
 * ligados 1:1 a un Event, con una única variante GENERAL cuyo stockAvailable
 * es el aforo. Reutiliza el mismo Cart/Checkout/Stripe que la tienda — este
 * endpoint solo expone el catálogo, igual que /api/shop y /api/drops.
 */
export async function listTicketsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const cached = await getCached(CACHE_KEYS.tickets);
  if (cached) {
    return reply.header("X-Cache", "HIT").send(cached);
  }

  const tickets = await prisma.product.findMany({
    where: { productType: ProductType.TICKET_EVENTO, status: ProductStatus.ACTIVO },
    include: {
      variants: { select: { id: true, size: true, stockAvailable: true } },
      event: { select: { id: true, title: true, date: true, venue: true, posterUrl: true, status: true } },
    },
    orderBy: { event: { date: "asc" } },
  });

  const payload = { tickets };
  await setCached(CACHE_KEYS.tickets, payload, CACHE_TTL_SECONDS.tickets);

  return reply.header("X-Cache", "MISS").send(payload);
}
