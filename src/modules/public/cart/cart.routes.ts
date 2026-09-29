import { FastifyInstance } from "fastify";
import {
  addItemHandler,
  applyDiscountHandler,
  getCartHandler,
  quoteHandler,
  restoreCartHandler,
  setCartEmailHandler,
  removeItemHandler,
  updateItemHandler,
} from "./cart.controller";

export async function cartRoutes(fastify: FastifyInstance) {
  fastify.get("/:cartId", getCartHandler);
  fastify.post("/items", addItemHandler);
  fastify.patch("/:cartId/items/:productVariantId", updateItemHandler);
  fastify.delete("/:cartId/items/:productVariantId", removeItemHandler);
  fastify.post("/discount", applyDiscountHandler);
  fastify.patch("/:cartId/email", setCartEmailHandler);
  fastify.post("/:cartId/restore", restoreCartHandler);
  fastify.post("/:cartId/quote", quoteHandler);
}
