import { FastifyInstance } from "fastify";
import { creditNoteHandler, invoiceHandler, trackOrderHandler } from "./orders.controller";

export async function publicOrdersRoutes(fastify: FastifyInstance) {
  fastify.get("/:id", trackOrderHandler);
  fastify.get("/:id/invoice", invoiceHandler);
  fastify.get("/:id/credit-note", creditNoteHandler);
}
