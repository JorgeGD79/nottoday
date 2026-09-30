import { z } from "zod";
import { EventStatus } from "@prisma/client";

// Cada entrada del line-up referencia un artista ya existente por su ID.
const lineupEntrySchema = z.object({
  artistId: z.string().cuid(),
  setTime: z.coerce.date().optional(),
  billing: z.number().int().nonnegative().default(0),
});

const baseFields = {
  title: z.string().min(2).max(200),
  date: z.coerce.date(),
  venue: z.string().min(2).max(200),
  description: z.string().max(5000).optional(),
  posterUrl: z.string().url().optional(),
  price: z.number().nonnegative(),
  // Aforo total; null = el evento no vende entradas.
  capacity: z.number().int().positive().max(100_000).nullable(),
  status: z.nativeEnum(EventStatus),
  lineup: z.array(lineupEntrySchema),
};

// Las entradas se cobran con Stripe, que no admite importes 0: vender entradas
// exige precio. Un evento gratuito se publica sin aforo (sin venta).
const ticketsNeedPrice = (data: { price?: number; capacity?: number | null }) =>
  !data.capacity || data.price === undefined || data.price > 0;
const ticketsNeedPriceError = {
  message: "Para vender entradas el precio debe ser mayor que 0",
  path: ["price"],
};

export const createEventSchema = z
  .object({
    ...baseFields,
    price: baseFields.price.default(0),
    capacity: baseFields.capacity.default(null),
    status: baseFields.status.default(EventStatus.BORRADOR),
    lineup: baseFields.lineup.default([]),
  })
  .refine(ticketsNeedPrice, ticketsNeedPriceError);

export const updateEventSchema = z.object(baseFields).partial().refine(ticketsNeedPrice, ticketsNeedPriceError);

export const eventIdParamsSchema = z.object({ id: z.string().cuid() });

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
