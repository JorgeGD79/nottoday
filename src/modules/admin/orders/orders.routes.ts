import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isAdmin, isStaffOrAdmin } from "@/middleware/authorize";
import {
  cancelOrderHandler,
  listOrdersHandler,
  refundOrderHandler,
  updateFulfillmentHandler,
} from "./orders.controller";

export async function adminOrdersRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.get("/", listOrdersHandler);
  fastify.put("/:id/fulfillment", updateFulfillmentHandler);
  // Mover dinero es solo de ADMIN (el STAFF gestiona la logística).
  fastify.post("/:id/refund", { preHandler: [isAdmin] }, refundOrderHandler);
  fastify.post("/:id/cancel", { preHandler: [isAdmin] }, cancelOrderHandler);
}
