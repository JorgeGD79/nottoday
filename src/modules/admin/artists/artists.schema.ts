import { z } from "zod";
import { ArtistStatus } from "@prisma/client";

export const createArtistSchema = z.object({
  stageName: z.string().min(1).max(150),
  bio: z.string().max(5000).optional(),
  spotifyId: z.string().optional(),
  soundcloudId: z.string().optional(),
  instagram: z.string().optional(),
  youtube: z.string().url().optional(),
  images: z.array(z.string().url()).default([]),
  status: z.nativeEnum(ArtistStatus).default(ArtistStatus.ACTIVO),
  userId: z.string().cuid().optional(),
});

export const updateArtistSchema = createArtistSchema.partial();

export const artistIdParamsSchema = z.object({ id: z.string().cuid() });
