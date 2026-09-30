import { randomBytes } from "node:crypto";
import { OrderStatus, Prisma, ProductType, TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

/**
 * Código de entrada: 16 bytes aleatorios en base64url (22 caracteres). Es lo que
 * va en el QR y el único secreto de la entrada, así que debe ser no adivinable.
 */
export function generateTicketCode(): string {
  return randomBytes(16).toString("base64url");
}

// Formato válido de un código (para rechazar basura antes de tocar la BD).
export const TICKET_CODE_REGEX = /^[A-Za-z0-9_-]{16,64}$/;

// Reglas de venta del evento que aplican carrito y checkout a sus entradas.
export const ticketRulesSelect = {
  id: true,
  title: true,
  maxTicketsPerEmail: true,
  nominativeTickets: true,
} satisfies Prisma.EventSelect;

export type TicketRules = Prisma.EventGetPayload<{ select: typeof ticketRulesSelect }>;

/** Error del tope por pedido: nunca se pueden meter más entradas que el máximo por email. */
export function assertTicketQuantity(event: TicketRules | null, quantity: number) {
  if (event?.maxTicketsPerEmail && quantity > event.maxTicketsPerEmail) {
    throw new AppError(`Máximo ${event.maxTicketsPerEmail} entrada(s) por persona para ${event.title}`, 422);
  }
}

/**
 * Límite de entradas por email: las ya emitidas a ese email (válidas o usadas)
 * más las de sus pedidos aún PENDIENTE (pagos a medias), para que no se pueda
 * esquivar abriendo varios checkouts a la vez. Llamar dentro de la transacción
 * del checkout con la variante ya bloqueada, así dos compras simultáneas del
 * mismo evento se validan una detrás de otra.
 */
export async function assertTicketLimitForEmail(
  tx: Prisma.TransactionClient,
  event: TicketRules,
  email: string,
  quantity: number
) {
  const max = event.maxTicketsPerEmail;
  if (!max) return;
  const sameEmail = { equals: email, mode: "insensitive" as const };
  const [issued, pending] = await Promise.all([
    tx.ticket.count({
      where: { eventId: event.id, holderEmail: sameEmail, status: { in: [TicketStatus.VALIDA, TicketStatus.USADA] } },
    }),
    tx.orderItem.aggregate({
      where: { product: { eventId: event.id }, order: { status: OrderStatus.PENDIENTE, email: sameEmail } },
      _sum: { quantity: true },
    }),
  ]);
  const pendingQty = pending._sum.quantity ?? 0;
  const held = issued + pendingQty;
  if (held + quantity > max) {
    const left = Math.max(0, max - held);
    throw new AppError(
      `Máximo ${max} entrada(s) por persona para ${event.title}. ` +
        (left
          ? `Con este email solo puedes comprar ${left} más.`
          : `Este email ya tiene ${held}` +
            (pendingQty ? ` (${pendingQty} en un pago sin completar; se liberan si no se paga).` : ".")),
      422
    );
  }
}

/**
 * Nombres de los asistentes de una línea de entradas nominativas: uno por
 * unidad, sin vacíos. Devuelve [] si el evento no es nominativo.
 */
export function attendeeNamesFor(event: TicketRules, quantity: number, names: string[] | undefined) {
  if (!event.nominativeTickets) return [];
  const clean = (names ?? []).map((n) => n.trim().replace(/\s+/g, " "));
  if (clean.length !== quantity || clean.some((n) => n.length < 2)) {
    throw new AppError(`Las entradas de ${event.title} son nominativas: indica el nombre de cada asistente`, 422);
  }
  return clean;
}

/**
 * Emite una entrada por cada unidad de TICKET_EVENTO del pedido. Se llama
 * dentro de la misma transacción que marca el pedido como PAGADO, así que o se
 * confirman pago y entradas a la vez o ninguna de las dos cosas. En entradas
 * nominativas, cada una lleva el nombre de su asistente.
 */
export async function issueTicketsForOrder(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { include: { product: { select: { productType: true, eventId: true } } } } },
  });

  const data: Prisma.TicketCreateManyInput[] = [];
  for (const item of order.items) {
    if (item.product.productType !== ProductType.TICKET_EVENTO || !item.product.eventId) continue;
    for (let n = 0; n < item.quantity; n++) {
      data.push({
        code: generateTicketCode(),
        orderId: order.id,
        orderItemId: item.id,
        eventId: item.product.eventId,
        holderEmail: order.email,
        holderName: item.attendeeNames[n] || null,
      });
    }
  }

  if (data.length) await tx.ticket.createMany({ data });
  return data.length;
}

/** Anula todas las entradas aún válidas de un pedido (reembolso/cancelación). */
export async function voidTicketsForOrder(tx: Prisma.TransactionClient, orderId: string) {
  const result = await tx.ticket.updateMany({
    where: { orderId, status: TicketStatus.VALIDA },
    data: { status: TicketStatus.ANULADA },
  });
  return result.count;
}

const ticketPublicSelect = {
  id: true,
  code: true,
  status: true,
  holderEmail: true,
  holderName: true,
  checkedInAt: true,
  orderId: true,
  event: { select: { id: true, title: true, date: true, venue: true } },
} satisfies Prisma.TicketSelect;

/**
 * Check-in en puerta. El paso VALIDA -> USADA es un único UPDATE condicional,
 * así que si dos personas escanean la misma entrada a la vez (o alguien
 * reenvía una captura del QR) solo una de las dos lecturas entra.
 *
 * Si se pasa eventId, la entrada tiene que ser de ese evento: evita dejar pasar
 * con la entrada de otra fecha.
 */
export async function checkInTicket(code: string, userId: string, eventId?: string) {
  const normalized = code.trim();
  if (!TICKET_CODE_REGEX.test(normalized)) {
    throw new AppError("Código de entrada no válido", 404);
  }

  const result = await prisma.ticket.updateMany({
    where: { code: normalized, status: TicketStatus.VALIDA, ...(eventId ? { eventId } : {}) },
    data: { status: TicketStatus.USADA, checkedInAt: new Date(), checkedInById: userId },
  });

  const ticket = await prisma.ticket.findUnique({ where: { code: normalized }, select: ticketPublicSelect });

  if (result.count === 1 && ticket) {
    return { ok: true as const, ticket };
  }

  // No entró: explicamos por qué para que la puerta sepa qué hacer.
  if (!ticket) throw new AppError("Entrada no encontrada", 404);
  if (eventId && ticket.event.id !== eventId) {
    throw new AppError(`Esta entrada es de otro evento: ${ticket.event.title}`, 409, { ticket });
  }
  if (ticket.status === TicketStatus.USADA) {
    throw new AppError("Entrada YA USADA", 409, { ticket });
  }
  if (ticket.status === TicketStatus.ANULADA) {
    throw new AppError("Entrada ANULADA (pedido reembolsado o cancelado)", 409, { ticket });
  }
  throw new AppError("No se pudo validar la entrada", 409, { ticket });
}
