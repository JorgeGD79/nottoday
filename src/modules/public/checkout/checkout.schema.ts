import { z } from "zod";

const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "País no válido (código ISO de 2 letras)");

export const checkoutSchema = z.object({
  cartId: z.string().cuid(),
  email: z.string().email(),
  currency: z.string().length(3).default("eur"),
  // Opcionales: un pedido solo de entradas no se envía a ningún sitio.
  // Si el carrito lleva productos físicos, el servicio los exige.
  shippingMethodId: z.string().cuid().optional(),
  shippingAddress: z
    .object({
      name: z.string().min(2).max(150),
      address: z.string().min(5).max(300),
      city: z.string().min(2).max(120),
      postalCode: z.string().min(3).max(20),
      country: countryCode,
      phone: z.string().max(30).optional(),
    })
    .optional(),
  // País del comprador cuando no hay envío (solo informativo en la factura).
  billingCountry: countryCode.optional(),
  // Entradas nominativas: asistentes (nombre y DNI/NIE/pasaporte) por
  // productVariantId de la entrada, uno por unidad y en orden.
  attendees: z
    .record(
      z.string().cuid(),
      z.array(z.object({ name: z.string().max(120), document: z.string().max(30) })).max(100)
    )
    .optional(),
  // Datos para factura completa (empresa/autónomo). Sin ellos: factura simplificada.
  billing: z
    .object({
      name: z.string().trim().max(200).optional(),
      taxId: z.string().trim().max(40).optional(),
    })
    .optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
