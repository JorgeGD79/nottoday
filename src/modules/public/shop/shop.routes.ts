import { FastifyInstance } from "fastify";
import { listShopProductsHandler, notifyMeHandler, productDetailHandler, shopFacetsHandler } from "./shop.controller";

export async function shopRoutes(fastify: FastifyInstance) {
  fastify.get("/", listShopProductsHandler);
  fastify.get("/facets", shopFacetsHandler);
  fastify.get("/products/:slug", productDetailHandler);
  // Límite estricto: cada aviso puede acabar en un email a esa dirección.
  fastify.post("/notify", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, notifyMeHandler);
}
