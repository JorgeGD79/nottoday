import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import { listOrdersHandler, updateFulfillmentHandler } from "./orders.controller";

export async function adminOrdersRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.get("/", listOrdersHandler);
  fastify.put("/:id/fulfillment", updateFulfillmentHandler);
}
