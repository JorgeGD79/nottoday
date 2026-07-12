import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isAdmin } from "@/middleware/authorize";
import { listAuditLogsHandler } from "./logs.controller";

export async function adminLogsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  // Auditar al staff es una capacidad exclusiva de ADMIN.
  fastify.addHook("preHandler", isAdmin);

  fastify.get("/", listAuditLogsHandler);
}
