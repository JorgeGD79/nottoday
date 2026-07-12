import { z } from "zod";
import { EventStatus } from "@prisma/client";

// Cada entrada del line-up referencia un artista ya existente por su ID.
const lineupEntrySchema = z.object({
  artistId: z.string().cuid(),
  setTime: z.coerce.date().optional(),
  billing: z.number().int().nonnegative().default(0),
});

export const createEventSchema = z.object({
  title: z.string().min(2).max(200),
  date: z.coerce.date(),
  venue: z.string().min(2).max(200),
  description: z.string().max(5000).optional(),
  posterUrl: z.string().url().optional(),
  price: z.number().nonnegative().default(0),
  status: z.nativeEnum(EventStatus).default(EventStatus.BORRADOR),
  lineup: z.array(lineupEntrySchema).default([]),
});

export const updateEventSchema = createEventSchema.partial();

export const eventIdParamsSchema = z.object({ id: z.string().cuid() });

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
