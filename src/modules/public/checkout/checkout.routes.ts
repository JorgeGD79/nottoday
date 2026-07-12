import { FastifyInstance } from "fastify";
import { checkoutHandler, stripeWebhookHandler } from "./checkout.controller";

export async function checkoutRoutes(fastify: FastifyInstance) {
  fastify.post("/", checkoutHandler);
  // Nota: registrado también bajo /api/checkout/webhook (ver app.ts) para que
  // Stripe pueda apuntar su endpoint de eventos fuera del prefijo /api/cart, etc.
  fastify.post("/webhook", stripeWebhookHandler);
}
