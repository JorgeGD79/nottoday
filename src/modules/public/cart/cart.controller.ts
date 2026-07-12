import { FastifyReply, FastifyRequest } from "fastify";
import {
  addItemSchema,
  applyDiscountSchema,
  cartIdParamsSchema,
  removeItemParamsSchema,
  updateItemBodySchema,
} from "./cart.schema";
import {
  addItemToCart,
  applyDiscountToCart,
  getCart,
  removeItemFromCart,
  setItemQuantity,
} from "./cart.service";

export async function getCartHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cartId } = cartIdParamsSchema.parse(request.params);
  const cart = await getCart(cartId);
  return reply.send({ cart });
}

export async function addItemHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = addItemSchema.parse(request.body);
  const cart = await addItemToCart(input);
  return reply.code(200).send({ cart });
}

export async function removeItemHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cartId, productVariantId } = removeItemParamsSchema.parse(request.params);
  const cart = await removeItemFromCart(cartId, productVariantId);
  return reply.send({ cart });
}

export async function updateItemHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cartId, productVariantId } = removeItemParamsSchema.parse(request.params);
  const { quantity } = updateItemBodySchema.parse(request.body);
  const cart = await setItemQuantity(cartId, productVariantId, quantity);
  return reply.send({ cart });
}

export async function applyDiscountHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = applyDiscountSchema.parse(request.body);
  const { cart, evaluation } = await applyDiscountToCart(input.cartId, input.code);
  return reply.send({ cart, discount: evaluation });
}
