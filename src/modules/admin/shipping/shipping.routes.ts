import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import {
  createShippingMethodHandler,
  deleteShippingMethodHandler,
  listShippingMethodsAdminHandler,
  updateShippingMethodHandler,
} from "./shipping.controller";

export async function adminShippingRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.get("/", listShippingMethodsAdminHandler);
  fastify.post("/", createShippingMethodHandler);
  fastify.put("/:id", updateShippingMethodHandler);
  fastify.delete("/:id", deleteShippingMethodHandler);
}
