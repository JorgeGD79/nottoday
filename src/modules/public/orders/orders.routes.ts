import { FastifyInstance } from "fastify";
import { trackOrderHandler } from "./orders.controller";

export async function publicOrdersRoutes(fastify: FastifyInstance) {
  fastify.get("/:id", trackOrderHandler);
}
