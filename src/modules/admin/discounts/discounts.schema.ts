import { z } from "zod";
import { DiscountType, DiscountStatus } from "@prisma/client";

export const createDiscountSchema = z
  .object({
    code: z
      .string()
      .min(3)
      .max(40)
      .transform((v) => v.trim().toUpperCase()),
    type: z.nativeEnum(DiscountType),
    value: z.number().nonnegative(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    maxUses: z.number().int().positive().optional(),
    minPurchaseAmount: z.number().nonnegative().default(0),
    status: z.nativeEnum(DiscountStatus).default(DiscountStatus.ACTIVO),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "endDate debe ser posterior a startDate",
    path: ["endDate"],
  })
  .refine((data) => data.type !== DiscountType.PORCENTAJE || data.value <= 100, {
    message: "Un descuento de tipo PORCENTAJE no puede superar 100",
    path: ["value"],
  });

export const updateDiscountSchema = z.object({
  type: z.nativeEnum(DiscountType).optional(),
  value: z.number().nonnegative().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  maxUses: z.number().int().positive().optional(),
  minPurchaseAmount: z.number().nonnegative().optional(),
  status: z.nativeEnum(DiscountStatus).optional(),
});

export const discountIdParamsSchema = z.object({ id: z.string().cuid() });
