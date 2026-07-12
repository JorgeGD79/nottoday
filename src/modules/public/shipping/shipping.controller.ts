import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";

/**
 * GET /api/shipping
 *
 * Métodos de envío disponibles en el checkout. Los define el admin desde su
 * panel (nombre + coste); aquí solo se exponen los activos, ordenados.
 */
export async function listShippingMethodsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const cached = await getCached(CACHE_KEYS.shipping);
  if (cached) {
    return reply.header("X-Cache", "HIT").send(cached);
  }

  const methods = await prisma.shippingMethod.findMany({
    where: { active: true },
    select: { id: true, name: true, description: true, price: true },
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });

  const payload = { methods };
  await setCached(CACHE_KEYS.shipping, payload, CACHE_TTL_SECONDS.shipping);

  return reply.header("X-Cache", "MISS").send(payload);
}
