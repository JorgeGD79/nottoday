import { FastifyInstance } from "fastify";
import { subscribeHandler, unsubscribeHandler } from "./newsletter.controller";

export async function publicNewsletterRoutes(fastify: FastifyInstance) {
  // Límite estricto: cada alta puede disparar un email, no queremos que sirva para spamear.
  fastify.post("/subscribe", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, subscribeHandler);
  fastify.post("/unsubscribe", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, unsubscribeHandler);
}
