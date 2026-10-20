import { FastifyInstance } from "fastify";
import { creditNoteHandler, invoiceHandler, trackOrderHandler, withdrawOrderHandler } from "./orders.controller";

export async function publicOrdersRoutes(fastify: FastifyInstance) {
  fastify.get("/:id", trackOrderHandler);
  fastify.get("/:id/invoice", invoiceHandler);
  fastify.get("/:id/credit-note", creditNoteHandler);
  // Desistimiento online: cada uno manda dos emails (acuse + aviso interno).
  fastify.post("/:id/withdraw", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, withdrawOrderHandler);
}
