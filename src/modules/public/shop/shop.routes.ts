import { FastifyInstance } from "fastify";
import { listShopProductsHandler, productDetailHandler, shopFacetsHandler } from "./shop.controller";

export async function shopRoutes(fastify: FastifyInstance) {
  fastify.get("/", listShopProductsHandler);
  fastify.get("/facets", shopFacetsHandler);
  fastify.get("/products/:slug", productDetailHandler);
}
