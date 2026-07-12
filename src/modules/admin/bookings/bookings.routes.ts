import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import { listBookingsHandler, updateBookingStatusHandler } from "./bookings.controller";

export async function adminBookingsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.get("/", listBookingsHandler);
  fastify.put("/:id/status", updateBookingStatusHandler);
}
