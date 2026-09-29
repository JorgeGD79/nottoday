import { FastifyInstance } from "fastify";
import { listShippingCountriesHandler, listShippingMethodsHandler } from "./shipping.controller";

export async function publicShippingRoutes(fastify: FastifyInstance) {
  fastify.get("/", listShippingMethodsHandler);
  fastify.get("/countries", listShippingCountriesHandler);
}
