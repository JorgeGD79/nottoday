import { z } from "zod";
import { ProductType, ProductStatus, DropStatus } from "@prisma/client";

// Una línea de inventario por variante (talla + color opcional), enviada junto
// con el producto en el mismo payload. El orden del array es el de la tienda.
const variantSchema = z.object({
  size: z.string().trim().min(1, "La talla no puede estar vacía").max(40),
  color: z.string().trim().max(40).default(""),
  sku: z.string().trim().max(60).optional(),
  stockAvailable: z.number().int().nonnegative().default(0),
});

// Metadatos de drop, solo obligatorios cuando productType = DROP_EXCLUSIVO.
const dropMetaSchema = z.object({
  releaseAt: z.coerce.date(),
  dropStatus: z.nativeEnum(DropStatus).default(DropStatus.PROXIMAMENTE),
});

const noDuplicateVariants = (variants: { size: string; color: string }[] | undefined) => {
  if (!variants) return true;
  const keys = variants.map((v) => `${v.size.toLowerCase()}|${v.color.toLowerCase()}`);
  return new Set(keys).size === keys.length;
};

const baseFields = {
  name: z.string().min(2).max(200),
  description: z.string().max(5000),
  price: z.number().positive(),
  images: z.array(z.string().url()),
  productType: z.nativeEnum(ProductType),
  status: z.nativeEnum(ProductStatus),
  variants: z.array(variantSchema).max(100),
  dropMeta: dropMetaSchema,
  // Solo aplica (y es obligatorio) para productType = TICKET_EVENTO: liga
  // el ticket a su evento.
  eventId: z.string().cuid(),
};

export const createProductSchema = z
  .object({
    ...baseFields,
    description: baseFields.description.optional(),
    images: baseFields.images.default([]),
    productType: baseFields.productType.default(ProductType.TIENDA_GENERAL),
    status: baseFields.status.default(ProductStatus.BORRADOR),
    variants: baseFields.variants.min(1, "Debes indicar al menos una variante con su stock"),
    dropMeta: dropMetaSchema.optional(),
    eventId: baseFields.eventId.optional(),
  })
  .refine(
    (data) => data.productType !== ProductType.DROP_EXCLUSIVO || !!data.dropMeta,
    {
      message: "dropMeta (releaseAt) es obligatorio cuando productType es DROP_EXCLUSIVO",
      path: ["dropMeta"],
    }
  )
  .refine(
    (data) => data.productType !== ProductType.TICKET_EVENTO || !!data.eventId,
    {
      message: "eventId es obligatorio cuando productType es TICKET_EVENTO",
      path: ["eventId"],
    }
  )
  .refine((data) => noDuplicateVariants(data.variants), {
    message: "No puede haber dos variantes con la misma talla y color",
    path: ["variants"],
  });

export const updateProductSchema = z
  .object({
    ...baseFields,
    description: baseFields.description.optional(),
  })
  .partial()
  .refine((data) => noDuplicateVariants(data.variants), {
    message: "No puede haber dos variantes con la misma talla y color",
    path: ["variants"],
  });

export const productIdParamsSchema = z.object({
  id: z.string().cuid(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
