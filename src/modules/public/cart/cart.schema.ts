import { z } from "zod";

export const addItemSchema = z.object({
  cartId: z.string().cuid().optional(), // si no viene, se crea un carrito nuevo
  email: z.string().email().optional(),
  productId: z.string().cuid(),
  productVariantId: z.string().cuid(),
  quantity: z.number().int().positive().max(10).default(1),
});

export const applyDiscountSchema = z.object({
  cartId: z.string().cuid(),
  code: z.string().min(3).max(40),
});

export const cartIdParamsSchema = z.object({ cartId: z.string().cuid() });

export const removeItemParamsSchema = z.object({
  cartId: z.string().cuid(),
  productVariantId: z.string().cuid(),
});

// Fijar la cantidad de una línea. quantity 0 = eliminar la línea.
export const updateItemBodySchema = z.object({
  quantity: z.number().int().min(0).max(10),
});
