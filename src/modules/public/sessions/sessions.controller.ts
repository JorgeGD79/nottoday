import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";

/**
 * GET /api/sessions
 *
 * N-TY Sessions: sesiones grabadas alojadas en YouTube, de la más reciente
 * a la más antigua, con el artista resuelto. Alimenta la página de Sessions.
 */
export async function listPublicSessionsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const cached = await getCached(CACHE_KEYS.sessions);
  if (cached) {
    return reply.header("X-Cache", "HIT").send(cached);
  }

  const sessions = await prisma.session.findMany({
    include: {
      artist: { select: { id: true, stageName: true, instagram: true } },
    },
    orderBy: { publishedAt: "desc" },
  });

  const payload = { sessions };
  await setCached(CACHE_KEYS.sessions, payload, CACHE_TTL_SECONDS.sessions);

  return reply.header("X-Cache", "MISS").send(payload);
}
