import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { CreateEventInput, UpdateEventInput } from "./events.schema";

/**
 * Crea un evento y vincula el line-up de artistas invitados en una única
 * transacción. Valida que todos los artistId existan y estén ACTIVO antes
 * de confirmar, para no publicar carteles con DJs dados de baja.
 */
export async function createEventWithLineup(input: CreateEventInput) {
  if (input.lineup.length > 0) {
    const artistIds = input.lineup.map((entry) => entry.artistId);
    const foundArtists = await prisma.artist.findMany({
      where: { id: { in: artistIds } },
      select: { id: true },
    });
    const missing = artistIds.filter((id) => !foundArtists.some((a) => a.id === id));
    if (missing.length > 0) {
      throw AppError.notFound(`Artista(s) no encontrado(s): ${missing.join(", ")}`);
    }
  }

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        title: input.title,
        date: input.date,
        venue: input.venue,
        description: input.description,
        posterUrl: input.posterUrl,
        price: input.price,
        status: input.status,
        lineup: {
          create: input.lineup.map((entry) => ({
            artistId: entry.artistId,
            setTime: entry.setTime,
            billing: entry.billing,
          })),
        },
      },
      include: { lineup: { include: { artist: true } } },
    });

    return event;
  });
}

export async function updateEventWithLineup(eventId: string, input: UpdateEventInput) {
  const existing = await prisma.event.findUnique({ where: { id: eventId } });
  if (!existing) throw AppError.notFound("Evento");

  return prisma.$transaction(async (tx) => {
    await tx.event.update({
      where: { id: eventId },
      data: {
        title: input.title,
        date: input.date,
        venue: input.venue,
        description: input.description,
        posterUrl: input.posterUrl,
        price: input.price,
        status: input.status,
      },
    });

    // Si se manda `lineup`, se trata como el cartel completo y sustituye al anterior.
    if (input.lineup) {
      await tx.eventLineup.deleteMany({ where: { eventId } });
      if (input.lineup.length > 0) {
        await tx.eventLineup.createMany({
          data: input.lineup.map((entry) => ({
            eventId,
            artistId: entry.artistId,
            setTime: entry.setTime,
            billing: entry.billing,
          })),
        });
      }
    }

    return tx.event.findUniqueOrThrow({
      where: { id: eventId },
      include: { lineup: { include: { artist: true } } },
    });
  });
}

export async function deleteEvent(eventId: string) {
  const existing = await prisma.event.findUnique({ where: { id: eventId } });
  if (!existing) throw AppError.notFound("Evento");
  await prisma.event.delete({ where: { id: eventId } });
}

export async function listEventsAdmin() {
  return prisma.event.findMany({
    include: { lineup: { include: { artist: true } } },
    orderBy: { date: "asc" },
  });
}
