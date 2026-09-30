import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { EventStatus, Prisma, ProductStatus } from "@prisma/client";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";

// Un evento sigue en "próximos" hasta 12 h después de su hora de inicio
// (la fiesta de esta noche no salta al archivo a medianoche).
const UPCOMING_GRACE_MS = 12 * 60 * 60 * 1000;
const ARCHIVE_LIMIT = 24;

const publicEventInclude = {
  lineup: {
    orderBy: { billing: "asc" },
    select: {
      billing: true,
      setTime: true,
      artist: { select: { id: true, stageName: true, instagram: true } },
    },
  },
  ticketProduct: {
    select: {
      id: true,
      price: true,
      status: true,
      variants: { where: { size: "GENERAL", active: true }, select: { id: true, stockAvailable: true, stockReserved: true } },
    },
  },
} satisfies Prisma.EventInclude;

type PublicEventRow = Prisma.EventGetPayload<{ include: typeof publicEventInclude }>;

// Entradas a la venta del evento (o null): lo justo para el botón de compra.
function toPublicEvent({ ticketProduct, ...event }: PublicEventRow, upcoming: boolean) {
  const variant = ticketProduct?.variants[0];
  const onSale = upcoming && ticketProduct?.status === ProductStatus.ACTIVO && !!variant;
  return {
    ...event,
    tickets: onSale
      ? {
          productId: ticketProduct.id,
          variantId: variant.id,
          price: ticketProduct.price,
          available: Math.max(0, variant.stockAvailable - variant.stockReserved),
        }
      : null,
  };
}

/**
 * GET /api/events
 *
 * Agenda pública del colectivo, con el line-up resuelto a nombre artístico:
 *   events  próximos eventos PUBLICADO (el más cercano primero), con sus
 *           entradas si están a la venta (`tickets`, null si no).
 *   past    archivo: eventos ya celebrados (PUBLICADO o FINALIZADO), del más
 *           reciente al más antiguo.
 * Alimenta la sección "Live Sets" de la home y la página de Eventos.
 */
export async function listPublicEventsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const cached = await getCached(CACHE_KEYS.events);
  if (cached) {
    return reply.header("X-Cache", "HIT").send(cached);
  }

  const cutoff = new Date(Date.now() - UPCOMING_GRACE_MS);
  const [upcoming, past] = await Promise.all([
    prisma.event.findMany({
      where: { status: EventStatus.PUBLICADO, date: { gte: cutoff } },
      include: publicEventInclude,
      orderBy: { date: "asc" },
    }),
    prisma.event.findMany({
      where: { status: { in: [EventStatus.PUBLICADO, EventStatus.FINALIZADO] }, date: { lt: cutoff } },
      include: publicEventInclude,
      orderBy: { date: "desc" },
      take: ARCHIVE_LIMIT,
    }),
  ]);

  const payload = {
    events: upcoming.map((e) => toPublicEvent(e, true)),
    past: past.map((e) => toPublicEvent(e, false)),
  };
  await setCached(CACHE_KEYS.events, payload, CACHE_TTL_SECONDS.events);

  return reply.header("X-Cache", "MISS").send(payload);
}
