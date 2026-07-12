import { z } from "zod";

export const createSessionSchema = z.object({
  title: z.string().min(1).max(150),
  youtubeUrl: z.string().url(),
  description: z.string().max(5000).optional(),
  publishedAt: z.coerce.date().optional(),
  artistId: z.string().cuid(),
});

export const updateSessionSchema = createSessionSchema.partial();

export const sessionIdParamsSchema = z.object({ id: z.string().cuid() });
