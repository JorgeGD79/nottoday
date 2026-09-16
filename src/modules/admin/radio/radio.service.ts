import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { CreateRadioShowInput, UpdateRadioShowInput } from "./radio.schema";

const TRACKS_INCLUDE = { tracks: { orderBy: { sortOrder: "asc" as const } } };

export async function createRadioShowWithTracks(input: CreateRadioShowInput) {
  return prisma.$transaction(async (tx) => {
    const show = await tx.radioShow.create({
      data: {
        title: input.title,
        host: input.host,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        active: input.active,
        tracks: {
          create: input.tracks.map((track, index) => ({ ...track, sortOrder: index })),
        },
      },
      include: TRACKS_INCLUDE,
    });
    return show;
  });
}

export async function updateRadioShowWithTracks(showId: string, input: UpdateRadioShowInput) {
  const existing = await prisma.radioShow.findUnique({ where: { id: showId } });
  if (!existing) throw AppError.notFound("Franja de radio");

  return prisma.$transaction(async (tx) => {
    await tx.radioShow.update({
      where: { id: showId },
      data: {
        title: input.title,
        host: input.host,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        active: input.active,
      },
    });

    // Si se manda `tracks`, se trata como la playlist completa y sustituye a la anterior.
    if (input.tracks) {
      await tx.radioTrack.deleteMany({ where: { radioShowId: showId } });
      if (input.tracks.length > 0) {
        await tx.radioTrack.createMany({
          data: input.tracks.map((track, index) => ({ ...track, radioShowId: showId, sortOrder: index })),
        });
      }
    }

    return tx.radioShow.findUniqueOrThrow({ where: { id: showId }, include: TRACKS_INCLUDE });
  });
}

export async function deleteRadioShow(showId: string) {
  const existing = await prisma.radioShow.findUnique({ where: { id: showId } });
  if (!existing) throw AppError.notFound("Franja de radio");
  await prisma.radioShow.delete({ where: { id: showId } });
}

export async function listRadioShowsAdmin() {
  return prisma.radioShow.findMany({
    include: TRACKS_INCLUDE,
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
}
