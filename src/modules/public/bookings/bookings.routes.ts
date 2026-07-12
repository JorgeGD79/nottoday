import { FastifyInstance } from "fastify";
import { createBookingHandler } from "./bookings.controller";

export async function publicBookingsRoutes(fastify: FastifyInstance) {
  fastify.post("/", createBookingHandler);
}
