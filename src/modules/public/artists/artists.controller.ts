import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { ArtistStatus, Prisma } from "@prisma/client";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";

const publicArtistSelect = {
  id: true,
  slug: true,
  stageName: true,
  bio: true,
  spotifyId: true,
  soundcloudId: true,
  instagram: true,
  youtube: true,
  images: true,
  sessions: {
    orderBy: { publishedAt: "desc" },
    select: { id: true, title: true, youtubeUrl: true, publishedAt: true },
  },
} satisfies Prisma.ArtistSelect;

/**
 * GET /api/artists
 *
 * Roster público del colectivo: solo artistas ACTIVO, con sus N-TY Sessions
 * publicadas. Alimenta la página de Artists del frontend.
 */
export async function listPublicArtistsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const cached = await getCached(CACHE_KEYS.artists);
  if (cached) {
    return reply.header("X-Cache", "HIT").send(cached);
  }

  const artists = await prisma.artist.findMany({
    where: { status: ArtistStatus.ACTIVO },
    select: publicArtistSelect,
    orderBy: { stageName: "asc" },
  });

  const payload = { artists };
  await setCached(CACHE_KEYS.artists, payload, CACHE_TTL_SECONDS.artists);

  return reply.header("X-Cache", "MISS").send(payload);
}

/** Artista del roster por slug para su página /artista/<slug> (SEO); null si no es público. */
export function findPublicArtist(slug: string) {
  return prisma.artist.findFirst({ where: { slug, status: ArtistStatus.ACTIVO }, select: publicArtistSelect });
}
