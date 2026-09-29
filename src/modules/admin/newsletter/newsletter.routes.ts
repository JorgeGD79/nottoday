import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isAdmin } from "@/middleware/authorize";
import { exportSubscribersHandler, listSubscribersHandler } from "./newsletter.controller";

export async function adminNewsletterRoutes(fastify: FastifyInstance) {
  // Datos personales de terceros: solo ADMIN.
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isAdmin);

  fastify.get("/", listSubscribersHandler);
  fastify.get("/export", exportSubscribersHandler);
}
