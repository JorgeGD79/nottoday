import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkInTicket } from "@/services/ticket.service";

const listQuerySchema = z.object({
  eventId: z.string().cuid(),
  q: z.string().trim().max(120).optional(),
});

/**
 * GET /api/admin/tickets?eventId=...&q=...
 *
 * Lista de asistentes de un evento (una fila por entrada) con los contadores
 * de la puerta. `q` filtra por email o por el principio del código.
 */
export async function listTicketsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { eventId, q } = listQuerySchema.parse(request.query);

  const [tickets, grouped] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        eventId,
        ...(q
          ? { OR: [{ holderEmail: { contains: q, mode: "insensitive" } }, { code: { startsWith: q } }] }
          : {}),
      },
      select: {
        id: true,
        code: true,
        status: true,
        holderEmail: true,
        checkedInAt: true,
        orderId: true,
        createdAt: true,
        checkedInBy: { select: { name: true } },
      },
      orderBy: [{ holderEmail: "asc" }, { createdAt: "asc" }],
      take: 1000,
    }),
    prisma.ticket.groupBy({ by: ["status"], where: { eventId }, _count: { _all: true } }),
  ]);

  const count = (s: TicketStatus) => grouped.find((g) => g.status === s)?._count._all ?? 0;
  const stats = {
    valid: count(TicketStatus.VALIDA),
    used: count(TicketStatus.USADA),
    voided: count(TicketStatus.ANULADA),
  };

  return reply.send({ tickets, stats: { ...stats, sold: stats.valid + stats.used } });
}

const checkInSchema = z.object({
  code: z.string().trim().min(1).max(200),
  eventId: z.string().cuid().optional(),
});

/**
 * POST /api/admin/tickets/check-in — valida una entrada en la puerta.
 * 200 = puede pasar. 404/409 = no puede pasar (el mensaje explica por qué:
 * no existe, ya usada, anulada o de otro evento).
 */
export async function checkInHandler(request: FastifyRequest, reply: FastifyReply) {
  const { code, eventId } = checkInSchema.parse(request.body);
  const result = await checkInTicket(code, request.user.id, eventId);
  return reply.send(result);
}
