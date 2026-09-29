import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isAdmin, isStaffOrAdmin } from "@/middleware/authorize";
import {
  adminCreditNoteHandler,
  adminInvoiceHandler,
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
  fastify.get("/:id/invoice", adminInvoiceHandler);
  fastify.get("/:id/credit-note", adminCreditNoteHandler);
  // Mover dinero es solo de ADMIN (el STAFF gestiona la logística).
  fastify.post("/:id/refund", { preHandler: [isAdmin] }, refundOrderHandler);
  fastify.post("/:id/cancel", { preHandler: [isAdmin] }, cancelOrderHandler);
}
