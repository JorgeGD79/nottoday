import { z } from "zod";

export const createShippingMethodSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  price: z.number().nonnegative(),
  pricePerExtraKg: z.number().nonnegative().default(0),
  maxWeightGrams: z.number().int().positive().nullable().optional(),
  freeOverAmount: z.number().nonnegative().nullable().optional(),
  // null = el método vale para cualquier país.
  zoneId: z.string().cuid().nullable().optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().default(0),
});

export const updateShippingMethodSchema = createShippingMethodSchema.partial();

export const shippingMethodIdParamsSchema = z.object({ id: z.string().cuid() });

const countryList = z
  .array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Código de país ISO de 2 letras"))
  .max(250)
  .transform((list) => [...new Set(list)]);

export const createShippingZoneSchema = z.object({
  name: z.string().min(2).max(120),
  countries: countryList.default([]),
  restOfWorld: z.boolean().default(false),
  taxExempt: z.boolean().default(false),
  sortOrder: z.number().int().nonnegative().default(0),
});

export const updateShippingZoneSchema = createShippingZoneSchema.partial();
