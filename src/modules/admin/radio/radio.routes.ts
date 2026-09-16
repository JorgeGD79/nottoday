import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import {
  createRadioShowHandler,
  deleteRadioShowHandler,
  listRadioShowsHandler,
  updateRadioShowHandler,
} from "./radio.controller";

export async function adminRadioRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.get("/", listRadioShowsHandler);
  fastify.post("/", createRadioShowHandler);
  fastify.put("/:id", updateRadioShowHandler);
  fastify.delete("/:id", deleteRadioShowHandler);
}
