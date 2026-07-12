import { z } from "zod";
import { ProductType, ProductStatus, DropStatus, Size } from "@prisma/client";

// Una línea de inventario por talla, enviada junto con el producto en el mismo payload.
const variantSchema = z.object({
  size: z.nativeEnum(Size),
  stockAvailable: z.number().int().nonnegative().default(0),
});

// Metadatos de drop, solo obligatorios cuando productType = DROP_EXCLUSIVO.
const dropMetaSchema = z.object({
  releaseAt: z.coerce.date(),
  dropStatus: z.nativeEnum(DropStatus).default(DropStatus.PROXIMAMENTE),
});

export const createProductSchema = z
  .object({
    name: z.string().min(2).max(200),
    description: z.string().max(5000).optional(),
    price: z.number().positive(),
    images: z.array(z.string().url()).default([]),
    productType: z.nativeEnum(ProductType).default(ProductType.TIENDA_GENERAL),
    status: z.nativeEnum(ProductStatus).default(ProductStatus.BORRADOR),
    variants: z.array(variantSchema).min(1, "Debes indicar al menos una talla con su stock"),
    dropMeta: dropMetaSchema.optional(),
  })
  .refine(
    (data) => data.productType !== ProductType.DROP_EXCLUSIVO || !!data.dropMeta,
    {
      message: "dropMeta (releaseAt) es obligatorio cuando productType es DROP_EXCLUSIVO",
      path: ["dropMeta"],
    }
  )
  .refine(
    (data) => {
      const sizes = data.variants.map((v) => v.size);
      return new Set(sizes).size === sizes.length;
    },
    { message: "No puede haber tallas duplicadas en el mismo producto", path: ["variants"] }
  );

export const updateProductSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(5000).optional(),
  price: z.number().positive().optional(),
  images: z.array(z.string().url()).optional(),
  productType: z.nativeEnum(ProductType).optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  variants: z.array(variantSchema).optional(),
  dropMeta: dropMetaSchema.optional(),
});

export const productIdParamsSchema = z.object({
  id: z.string().cuid(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
