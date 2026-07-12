import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import {
  createSessionHandler,
  deleteSessionHandler,
  listSessionsHandler,
  updateSessionHandler,
} from "./sessions.controller";

export async function adminSessionsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.get("/", listSessionsHandler);
  fastify.post("/", createSessionHandler);
  fastify.put("/:id", updateSessionHandler);
  fastify.delete("/:id", deleteSessionHandler);
}
