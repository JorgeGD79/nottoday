import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { ProductType } from "@prisma/client";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";

/**
 * GET /api/drops
 *
 * Endpoint de mayor concurrencia de toda la API pública: en el minuto de
 * apertura de un drop exclusivo recibe una oleada de tráfico. Se sirve desde
 * Redis con TTL corto (30s) para poder absorber miles de req/s sin golpear
 * Postgres en cada request; en caso de cache miss se recalcula y se repuebla.
 */
export async function listDropsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const cached = await getCached(CACHE_KEYS.drops);
  if (cached) {
    return reply.header("X-Cache", "HIT").send(cached);
  }

  const drops = await prisma.product.findMany({
    where: { productType: ProductType.DROP_EXCLUSIVO, dropMeta: { isNot: null } },
    include: {
      variants: { select: { id: true, size: true, stockAvailable: true } },
      dropMeta: true,
    },
    orderBy: { dropMeta: { releaseAt: "asc" } },
  });

  const payload = { drops };
  await setCached(CACHE_KEYS.drops, payload, CACHE_TTL_SECONDS.drops);

  return reply.header("X-Cache", "MISS").send(payload);
}
