import { FastifyInstance } from "fastify";
import { listShopProductsHandler } from "./shop.controller";

export async function shopRoutes(fastify: FastifyInstance) {
  fastify.get("/", listShopProductsHandler);
}
