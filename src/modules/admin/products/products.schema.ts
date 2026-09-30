import { z } from "zod";
import { ProductType, ProductStatus, DropStatus } from "@prisma/client";
import { SLUG_REGEX } from "@/utils/slug";

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
  slug: z.string().trim().toLowerCase().regex(SLUG_REGEX, "Slug no válido (a-z, 0-9 y guiones)").max(80),
  description: z.string().max(5000),
  price: z.number().positive(),
  taxRate: z.number().min(0).max(100),
  weightGrams: z.number().int().nonnegative().max(100_000),
  images: z.array(z.string().url()),
  productType: z.nativeEnum(ProductType),
  status: z.nativeEnum(ProductStatus),
  categoryId: z.string().cuid().nullable(),
  seoTitle: z.string().trim().max(70),
  seoDescription: z.string().trim().max(160),
  variants: z.array(variantSchema).max(100),
  dropMeta: dropMetaSchema,
};

// Las entradas (TICKET_EVENTO) no se crean aquí: las genera el evento a partir
// de su aforo (ver admin/events), para que aforo y stock no se desincronicen.
const notTicket = {
  message: "Las entradas se gestionan desde Eventos (precio y aforo del evento)",
  path: ["productType"],
};

export const createProductSchema = z
  .object({
    ...baseFields,
    slug: baseFields.slug.optional(),
    description: baseFields.description.optional(),
    taxRate: baseFields.taxRate.default(21),
    weightGrams: baseFields.weightGrams.default(0),
    images: baseFields.images.default([]),
    productType: baseFields.productType.default(ProductType.TIENDA_GENERAL),
    status: baseFields.status.default(ProductStatus.BORRADOR),
    categoryId: baseFields.categoryId.optional(),
    seoTitle: baseFields.seoTitle.optional(),
    seoDescription: baseFields.seoDescription.optional(),
    variants: baseFields.variants.min(1, "Debes indicar al menos una variante con su stock"),
    dropMeta: dropMetaSchema.optional(),
  })
  .refine((data) => data.productType !== ProductType.TICKET_EVENTO, notTicket)
  .refine(
    (data) => data.productType !== ProductType.DROP_EXCLUSIVO || !!data.dropMeta,
    {
      message: "dropMeta (releaseAt) es obligatorio cuando productType es DROP_EXCLUSIVO",
      path: ["dropMeta"],
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
    seoTitle: baseFields.seoTitle.optional(),
    seoDescription: baseFields.seoDescription.optional(),
  })
  .partial()
  .refine((data) => data.productType !== ProductType.TICKET_EVENTO, notTicket)
  .refine((data) => noDuplicateVariants(data.variants), {
    message: "No puede haber dos variantes con la misma talla y color",
    path: ["variants"],
  });

export const productIdParamsSchema = z.object({
  id: z.string().cuid(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
