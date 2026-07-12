import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { BookingStatus } from "@prisma/client";
import { recordAuditLog } from "@/services/audit-log.service";

const listQuerySchema = z.object({
  status: z.nativeEnum(BookingStatus).optional(),
});

// GET /api/admin/bookings — solicitudes de contratación/colaboración entrantes
export async function listBookingsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { status } = listQuerySchema.parse(request.query);

  const bookings = await prisma.booking.findMany({
    where: status ? { status } : undefined,
    include: { artist: { select: { id: true, stageName: true } } },
    orderBy: { createdAt: "desc" },
  });

  return reply.send({ bookings });
}

const updateStatusSchema = z.object({ status: z.nativeEnum(BookingStatus) });
const bookingIdParamsSchema = z.object({ id: z.string().cuid() });

// PUT /api/admin/bookings/:id/status — el staff mueve la solicitud por el flujo de revisión.
export async function updateBookingStatusHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = bookingIdParamsSchema.parse(request.params);
  const { status } = updateStatusSchema.parse(request.body);

  const existing = await prisma.booking.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Solicitud de booking");

  const booking = await prisma.booking.update({ where: { id }, data: { status } });

  await recordAuditLog({
    userId: request.user.id,
    action: `Cambió el estado del booking de "${existing.requesterName}" a ${status}`,
    request,
    metadata: { bookingId: id, previousStatus: existing.status, newStatus: status },
  });

  return reply.send({ booking });
}
