import { z } from "zod";
import { Weekday } from "@prisma/client";

const trackSchema = z.object({
  title: z.string().min(1).max(150),
  artist: z.string().min(1).max(150),
  audioUrl: z.string().url(),
  durationSeconds: z.number().int().positive(),
});

export const createRadioShowSchema = z.object({
  title: z.string().min(1).max(150),
  host: z.string().min(1).max(150),
  dayOfWeek: z.nativeEnum(Weekday),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido (HH:mm)"),
  active: z.boolean().default(true),
  tracks: z.array(trackSchema).default([]),
});

export const updateRadioShowSchema = createRadioShowSchema.partial();

export const radioShowIdParamsSchema = z.object({ id: z.string().cuid() });

export type CreateRadioShowInput = z.infer<typeof createRadioShowSchema>;
export type UpdateRadioShowInput = z.infer<typeof updateRadioShowSchema>;
