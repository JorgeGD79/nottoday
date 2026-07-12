import { FastifyInstance } from "fastify";
import { listShippingMethodsHandler } from "./shipping.controller";

export async function publicShippingRoutes(fastify: FastifyInstance) {
  fastify.get("/", listShippingMethodsHandler);
}
