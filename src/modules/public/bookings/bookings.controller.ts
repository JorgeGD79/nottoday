import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { createBookingSchema } from "./bookings.schema";

/**
 * POST /api/bookings — formulario público de contratación/colaboración.
 * Sin autenticación (lo rellena cualquier promotor/artista externo);
 * aparece luego en GET /api/admin/bookings para que el staff lo gestione.
 */
export async function createBookingHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createBookingSchema.parse(request.body);
  const booking = await prisma.booking.create({ data: input });
  return reply.code(201).send({ booking });
}
