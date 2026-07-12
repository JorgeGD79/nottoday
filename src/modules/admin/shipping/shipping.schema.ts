import { z } from "zod";

export const createShippingMethodSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  price: z.number().nonnegative(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().default(0),
});

export const updateShippingMethodSchema = createShippingMethodSchema.partial();

export const shippingMethodIdParamsSchema = z.object({ id: z.string().cuid() });
