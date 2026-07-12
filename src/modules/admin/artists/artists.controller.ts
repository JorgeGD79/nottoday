import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { recordAuditLog } from "@/services/audit-log.service";
import { invalidateArtistsCache } from "@/services/cache.service";
import { artistIdParamsSchema, createArtistSchema, updateArtistSchema } from "./artists.schema";

export async function listArtistsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const artists = await prisma.artist.findMany({ orderBy: { stageName: "asc" } });
  return reply.send({ artists });
}

export async function createArtistHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createArtistSchema.parse(request.body);
  const artist = await prisma.artist.create({ data: input });
  await invalidateArtistsCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Dio de alta al artista "${artist.stageName}"`,
    request,
    metadata: { artistId: artist.id },
  });

  return reply.code(201).send({ artist });
}

export async function updateArtistHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = artistIdParamsSchema.parse(request.params);
  const input = updateArtistSchema.parse(request.body);

  const existing = await prisma.artist.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Artista");

  const artist = await prisma.artist.update({ where: { id }, data: input });
  await invalidateArtistsCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Actualizó el perfil del artista "${artist.stageName}"`,
    request,
    metadata: { artistId: id, changes: input },
  });

  return reply.send({ artist });
}

export async function deleteArtistHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = artistIdParamsSchema.parse(request.params);

  const existing = await prisma.artist.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Artista");

  await prisma.artist.delete({ where: { id } });
  await invalidateArtistsCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Dio de baja al artista "${existing.stageName}"`,
    request,
    metadata: { artistId: id },
  });

  return reply.code(204).send();
}
