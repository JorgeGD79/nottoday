import { FastifyReply, FastifyRequest } from "fastify";
import { createEventSchema, eventIdParamsSchema, updateEventSchema } from "./events.schema";
import {
  createEventWithLineup,
  deleteEvent,
  listEventsAdmin,
  updateEventWithLineup,
} from "./events.service";
import { recordAuditLog } from "@/services/audit-log.service";
import { invalidateEventsCache } from "@/services/cache.service";

export async function listEventsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const events = await listEventsAdmin();
  return reply.send({ events });
}

/**
 * POST /api/admin/events
 *
 * Programa una nueva fiesta y vincula de una sola vez a los artistas
 * invitados (line-up), validando que cada artista exista antes de crear
 * el evento. Registra la acción, incluyendo los nombres del cartel, en
 * la tabla de auditoría.
 */
export async function createEventHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createEventSchema.parse(request.body);

  const event = await createEventWithLineup(input);
  await invalidateEventsCache();

  const lineupNames = event.lineup.map((l) => l.artist.stageName).join(", ") || "sin line-up";

  await recordAuditLog({
    userId: request.user.id,
    action: `Programó el evento "${event.title}" (${lineupNames})`,
    request,
    metadata: {
      eventId: event.id,
      date: event.date,
      lineup: event.lineup.map((l) => ({ artistId: l.artistId, stageName: l.artist.stageName })),
    },
  });

  return reply.code(201).send({ event });
}

export async function updateEventHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = eventIdParamsSchema.parse(request.params);
  const input = updateEventSchema.parse(request.body);

  const event = await updateEventWithLineup(id, input);
  await invalidateEventsCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Actualizó el evento "${event.title}" (${id})`,
    request,
    metadata: { eventId: id, changes: input },
  });

  return reply.send({ event });
}

export async function deleteEventHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = eventIdParamsSchema.parse(request.params);

  await deleteEvent(id);
  await invalidateEventsCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Eliminó el evento (${id})`,
    request,
    metadata: { eventId: id },
  });

  return reply.code(204).send();
}
