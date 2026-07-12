import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { EventStatus } from "@prisma/client";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";

/**
 * GET /api/events
 *
 * Agenda pública del colectivo: solo eventos PUBLICADO (los próximos primero),
 * con el line-up resuelto a nombre artístico. Alimenta la sección "Live Sets"
 * de la home y la página de Projects del frontend.
 */
export async function listPublicEventsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const cached = await getCached(CACHE_KEYS.events);
  if (cached) {
    return reply.header("X-Cache", "HIT").send(cached);
  }

  const events = await prisma.event.findMany({
    where: { status: EventStatus.PUBLICADO },
    include: {
      lineup: {
        orderBy: { billing: "asc" },
        select: {
          billing: true,
          setTime: true,
          artist: { select: { id: true, stageName: true, instagram: true } },
        },
      },
    },
    orderBy: { date: "asc" },
  });

  const payload = { events };
  await setCached(CACHE_KEYS.events, payload, CACHE_TTL_SECONDS.events);

  return reply.header("X-Cache", "MISS").send(payload);
}
