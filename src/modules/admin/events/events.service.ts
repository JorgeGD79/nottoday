import { prisma } from "@/lib/prisma";
import { EventStatus, Prisma, ProductStatus, ProductType, TicketStatus } from "@prisma/client";
import { AppError } from "@/utils/AppError";
import { uniqueSlug } from "@/utils/slug";
import { CreateEventInput, UpdateEventInput } from "./events.schema";

type Tx = Prisma.TransactionClient;

// Tipo de IVA de las entradas a espectáculos (general).
const TICKET_TAX_RATE = 21;

const eventInclude = {
  lineup: { include: { artist: true } },
  ticketProduct: { include: { variants: { where: { size: "GENERAL" } } } },
} satisfies Prisma.EventInclude;

async function assertArtistsExist(lineup: { artistId: string }[] | undefined) {
  if (!lineup?.length) return;
  const artistIds = lineup.map((entry) => entry.artistId);
  const foundArtists = await prisma.artist.findMany({
    where: { id: { in: artistIds } },
    select: { id: true },
  });
  const missing = artistIds.filter((id) => !foundArtists.some((a) => a.id === id));
  if (missing.length > 0) {
    throw AppError.notFound(`Artista(s) no encontrado(s): ${missing.join(", ")}`);
  }
}

/**
 * Pone a la venta (o retira) las entradas del evento según su aforo. Las
 * entradas son un Product TICKET_EVENTO ligado 1:1 al evento, con una única
 * variante GENERAL cuyo stock es lo que queda: aforo - entradas emitidas.
 *   - Con aforo: se crea o actualiza el producto (nombre, precio y póster del
 *     evento). Solo está ACTIVO (a la venta) si el evento está PUBLICADO.
 *   - Sin aforo: el producto, si existía, pasa a BORRADOR (deja de venderse;
 *     se conserva porque los pedidos lo referencian).
 */
async function syncTicketProduct(tx: Tx, eventId: string) {
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, include: eventInclude });
  const product = event.ticketProduct;

  if (!event.capacity) {
    if (product && product.status !== ProductStatus.BORRADOR) {
      await tx.product.update({ where: { id: product.id }, data: { status: ProductStatus.BORRADOR } });
    }
    return;
  }

  // Stripe no cobra importes 0 (un evento gratis se publica sin aforo).
  if (Number(event.price) <= 0) {
    throw new AppError("Para vender entradas el precio debe ser mayor que 0", 422);
  }

  // Entradas emitidas que ocupan aforo (las anuladas ya volvieron al stock).
  const sold = await tx.ticket.count({
    where: { eventId, status: { in: [TicketStatus.VALIDA, TicketStatus.USADA] } },
  });
  const reserved = product?.variants[0]?.stockReserved ?? 0;
  if (event.capacity < sold + reserved) {
    throw AppError.conflict(
      `El aforo no puede ser menor que las entradas ya vendidas (${sold})` +
        (reserved ? ` más las reservadas en pagos pendientes (${reserved})` : "")
    );
  }

  const data = {
    name: `Entrada · ${event.title}`,
    description: event.description,
    price: event.price,
    images: event.posterUrl ? [event.posterUrl] : [],
    status: event.status === EventStatus.PUBLICADO ? ProductStatus.ACTIVO : ProductStatus.BORRADOR,
  };
  const stockAvailable = event.capacity - sold;

  if (!product) {
    const slug = await uniqueSlug(`entrada ${event.title}`, async (s) =>
      !!(await tx.product.findUnique({ where: { slug: s }, select: { id: true } })));
    await tx.product.create({
      data: {
        ...data,
        slug,
        taxRate: TICKET_TAX_RATE,
        weightGrams: 0,
        productType: ProductType.TICKET_EVENTO,
        eventId,
        variants: { create: [{ size: "GENERAL", color: "", stockAvailable }] },
      },
    });
    return;
  }

  await tx.product.update({ where: { id: product.id }, data });
  const variant = product.variants[0];
  if (variant) {
    await tx.productVariant.update({ where: { id: variant.id }, data: { stockAvailable, active: true } });
  } else {
    await tx.productVariant.create({ data: { productId: product.id, size: "GENERAL", color: "", stockAvailable } });
  }
}

/**
 * Crea un evento, vincula el line-up de artistas invitados y, si tiene aforo,
 * pone sus entradas a la venta; todo en una única transacción. Valida que los
 * artistId existan antes de confirmar.
 */
export async function createEventWithLineup(input: CreateEventInput) {
  await assertArtistsExist(input.lineup);

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        title: input.title,
        date: input.date,
        venue: input.venue,
        description: input.description,
        posterUrl: input.posterUrl,
        price: input.price,
        capacity: input.capacity,
        maxTicketsPerEmail: input.maxTicketsPerEmail,
        nominativeTickets: input.nominativeTickets,
        status: input.status,
        lineup: {
          create: input.lineup.map((entry) => ({
            artistId: entry.artistId,
            setTime: entry.setTime,
            billing: entry.billing,
          })),
        },
      },
    });

    await syncTicketProduct(tx, event.id);
    return tx.event.findUniqueOrThrow({ where: { id: event.id }, include: eventInclude });
  });
}

export async function updateEventWithLineup(eventId: string, input: UpdateEventInput) {
  const existing = await prisma.event.findUnique({ where: { id: eventId } });
  if (!existing) throw AppError.notFound("Evento");
  await assertArtistsExist(input.lineup);

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
        capacity: input.capacity,
        maxTicketsPerEmail: input.maxTicketsPerEmail,
        nominativeTickets: input.nominativeTickets,
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

    await syncTicketProduct(tx, eventId);
    return tx.event.findUniqueOrThrow({ where: { id: eventId }, include: eventInclude });
  });
}

export async function deleteEvent(eventId: string) {
  const existing = await prisma.event.findUnique({ where: { id: eventId }, include: { ticketProduct: true } });
  if (!existing) throw AppError.notFound("Evento");
  // Con entradas vendidas el evento no se borra (el FK Ticket->Event es RESTRICT):
  // se cancela o finaliza, para no perder el registro de lo vendido.
  const ticketCount = await prisma.ticket.count({ where: { eventId } });
  if (ticketCount > 0) {
    throw AppError.conflict(
      `No se puede eliminar: el evento tiene ${ticketCount} entrada(s) emitida(s). Cámbialo a CANCELADO o FINALIZADO.`
    );
  }
  await prisma.$transaction(async (tx) => {
    const product = existing.ticketProduct;
    if (product) {
      // Borrar el producto arrastraría las líneas de pedidos (pendientes o
      // fallidos) que lo referencian: en ese caso solo se retira de la venta.
      const inOrders = await tx.orderItem.count({ where: { productId: product.id } });
      if (inOrders) {
        await tx.product.update({ where: { id: product.id }, data: { status: ProductStatus.BORRADOR } });
      } else {
        await tx.product.delete({ where: { id: product.id } });
      }
    }
    await tx.event.delete({ where: { id: eventId } });
  });
}

/** Eventos del panel, con las entradas vendidas y si están a la venta. */
export async function listEventsAdmin() {
  const [events, sold] = await Promise.all([
    prisma.event.findMany({ include: eventInclude, orderBy: { date: "asc" } }),
    prisma.ticket.groupBy({
      by: ["eventId"],
      where: { status: { in: [TicketStatus.VALIDA, TicketStatus.USADA] } },
      _count: { _all: true },
    }),
  ]);
  const soldBy = new Map(sold.map((s) => [s.eventId, s._count._all]));
  return events.map((e) => ({
    ...e,
    ticketsSold: soldBy.get(e.id) ?? 0,
    ticketsOnSale: e.ticketProduct?.status === ProductStatus.ACTIVO,
  }));
}
