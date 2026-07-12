import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { recordAuditLog } from "@/services/audit-log.service";
import { invalidateArtistsCache } from "@/services/cache.service";
import { createSessionSchema, sessionIdParamsSchema, updateSessionSchema } from "./sessions.schema";

export async function listSessionsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const sessions = await prisma.session.findMany({
    include: { artist: { select: { id: true, stageName: true } } },
    orderBy: { publishedAt: "desc" },
  });
  return reply.send({ sessions });
}

/**
 * POST /api/admin/sessions
 *
 * Publica una nueva N-TY Session (vídeo ya subido a YouTube) asociada a un
 * artista del roster. Valida que el artista exista antes de crearla.
 */
export async function createSessionHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createSessionSchema.parse(request.body);

  const artist = await prisma.artist.findUnique({ where: { id: input.artistId } });
  if (!artist) throw AppError.notFound("Artista");

  const session = await prisma.session.create({
    data: input,
    include: { artist: { select: { id: true, stageName: true } } },
  });
  await invalidateArtistsCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Publicó la sesión "${session.title}" (${artist.stageName})`,
    request,
    metadata: { sessionId: session.id, artistId: artist.id, youtubeUrl: session.youtubeUrl },
  });

  return reply.code(201).send({ session });
}

export async function updateSessionHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = sessionIdParamsSchema.parse(request.params);
  const input = updateSessionSchema.parse(request.body);

  const existing = await prisma.session.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Sesión");

  if (input.artistId) {
    const artist = await prisma.artist.findUnique({ where: { id: input.artistId } });
    if (!artist) throw AppError.notFound("Artista");
  }

  const session = await prisma.session.update({
    where: { id },
    data: input,
    include: { artist: { select: { id: true, stageName: true } } },
  });
  await invalidateArtistsCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Actualizó la sesión "${session.title}" (${id})`,
    request,
    metadata: { sessionId: id, changes: input },
  });

  return reply.send({ session });
}

export async function deleteSessionHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = sessionIdParamsSchema.parse(request.params);

  const existing = await prisma.session.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Sesión");

  await prisma.session.delete({ where: { id } });
  await invalidateArtistsCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Eliminó la sesión "${existing.title}" (${id})`,
    request,
    metadata: { sessionId: id },
  });

  return reply.code(204).send();
}
