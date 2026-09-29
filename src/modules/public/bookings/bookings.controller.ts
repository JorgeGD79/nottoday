import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { sendEmail } from "@/services/email.service";
import { bookingReceivedEmail } from "@/services/email-templates";
import { createBookingSchema } from "./bookings.schema";

/**
 * POST /api/bookings — formulario público de contratación/colaboración.
 * Sin autenticación (lo rellena cualquier promotor/artista externo);
 * aparece luego en GET /api/admin/bookings para que el staff lo gestione.
 * Si hay buzón configurado (EMAIL_REPLY_TO), se avisa al equipo por email.
 */
export async function createBookingHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createBookingSchema.parse(request.body);
  const booking = await prisma.booking.create({ data: input });
  if (env.EMAIL_REPLY_TO) {
    await sendEmail({ to: env.EMAIL_REPLY_TO, ...bookingReceivedEmail(booking) });
  }
  return reply.code(201).send({ booking });
}
