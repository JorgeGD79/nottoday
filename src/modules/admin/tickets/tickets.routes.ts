import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import { checkInHandler, listTicketsHandler } from "./tickets.controller";

export async function adminTicketsRoutes(fastify: FastifyInstance) {
  // El personal de puerta es STAFF: check-in y lista de asistentes para ambos roles.
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.get("/", listTicketsHandler);
  // Límite propio más alto que el global: en la apertura de puertas se escanea en ráfaga.
  fastify.post("/check-in", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, checkInHandler);
}
