import { FastifyReply, FastifyRequest } from "fastify";
import { recordAuditLog } from "@/services/audit-log.service";
import { invalidateRadioCache } from "@/services/cache.service";
import { createRadioShowSchema, radioShowIdParamsSchema, updateRadioShowSchema } from "./radio.schema";
import {
  createRadioShowWithTracks,
  deleteRadioShow,
  listRadioShowsAdmin,
  updateRadioShowWithTracks,
} from "./radio.service";

export async function listRadioShowsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const shows = await listRadioShowsAdmin();
  return reply.send({ shows });
}

export async function createRadioShowHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createRadioShowSchema.parse(request.body);

  const show = await createRadioShowWithTracks(input);
  await invalidateRadioCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Creó la franja de radio "${show.title}" (${show.dayOfWeek} ${show.startTime})`,
    request,
    metadata: { radioShowId: show.id, tracks: show.tracks.length },
  });

  return reply.code(201).send({ show });
}

export async function updateRadioShowHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = radioShowIdParamsSchema.parse(request.params);
  const input = updateRadioShowSchema.parse(request.body);

  const show = await updateRadioShowWithTracks(id, input);
  await invalidateRadioCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Actualizó la franja de radio "${show.title}" (${id})`,
    request,
    metadata: { radioShowId: id, changes: input },
  });

  return reply.send({ show });
}

export async function deleteRadioShowHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = radioShowIdParamsSchema.parse(request.params);

  await deleteRadioShow(id);
  await invalidateRadioCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Eliminó la franja de radio (${id})`,
    request,
    metadata: { radioShowId: id },
  });

  return reply.code(204).send();
}
