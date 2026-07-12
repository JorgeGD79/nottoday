import { FastifyInstance } from "fastify";
import {
  addItemHandler,
  applyDiscountHandler,
  getCartHandler,
  removeItemHandler,
  updateItemHandler,
} from "./cart.controller";

export async function cartRoutes(fastify: FastifyInstance) {
  fastify.get("/:cartId", getCartHandler);
  fastify.post("/items", addItemHandler);
  fastify.patch("/:cartId/items/:productVariantId", updateItemHandler);
  fastify.delete("/:cartId/items/:productVariantId", removeItemHandler);
  fastify.post("/discount", applyDiscountHandler);
}
