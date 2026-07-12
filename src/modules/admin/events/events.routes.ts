import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import {
  createEventHandler,
  deleteEventHandler,
  listEventsHandler,
  updateEventHandler,
} from "./events.controller";

export async function adminEventsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.get("/", listEventsHandler);
  fastify.post("/", createEventHandler);
  fastify.put("/:id", updateEventHandler);
  fastify.delete("/:id", deleteEventHandler);
}
