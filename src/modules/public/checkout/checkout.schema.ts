import { z } from "zod";

export const checkoutSchema = z.object({
  cartId: z.string().cuid(),
  email: z.string().email(),
  currency: z.string().length(3).default("eur"),
  shippingMethodId: z.string().cuid(),
  shippingAddress: z.object({
    name: z.string().min(2).max(150),
    address: z.string().min(5).max(300),
    city: z.string().min(2).max(120),
    postalCode: z.string().min(3).max(20),
    country: z.string().min(2).max(80),
    phone: z.string().max(30).optional(),
  }),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
