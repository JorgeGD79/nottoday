import { FastifyReply, FastifyRequest } from "fastify";
import { createEventSchema, eventIdParamsSchema, updateEventSchema } from "./events.schema";
import {
  createEventWithLineup,
  deleteEvent,
  listEventsAdmin,
  updateEventWithLineup,
} from "./events.service";
import { recordAuditLog } from "@/services/audit-log.service";
import { invalidateCatalogCache, invalidateEventsCache } from "@/services/cache.service";

export async function listEventsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const events = await listEventsAdmin();
  return reply.send({ events });
}

/**
 * POST /api/admin/events
 *
 * Programa una nueva fiesta, vincula de una sola vez a los artistas
 * invitados (line-up) y, si tiene aforo, pone sus entradas a la venta.
 * Valida que cada artista exista antes de crear el evento. Registra la
 * acción, incluyendo los nombres del cartel, en la tabla de auditoría.
 */
export async function createEventHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createEventSchema.parse(request.body);

  const event = await createEventWithLineup(input);
  // El evento arrastra su producto-entrada: se invalida también /api/tickets.
  await Promise.all([invalidateEventsCache(), invalidateCatalogCache()]);

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
  // El evento arrastra su producto-entrada: se invalida también /api/tickets.
  await Promise.all([invalidateEventsCache(), invalidateCatalogCache()]);

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
  // El evento arrastra su producto-entrada: se invalida también /api/tickets.
  await Promise.all([invalidateEventsCache(), invalidateCatalogCache()]);

  await recordAuditLog({
    userId: request.user.id,
    action: `Eliminó el evento (${id})`,
    request,
    metadata: { eventId: id },
  });

  return reply.code(204).send();
}
