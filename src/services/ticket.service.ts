import { randomBytes } from "node:crypto";
import { Prisma, ProductType, TicketStatus } from "@prisma/client";
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

/**
 * Emite una entrada por cada unidad de TICKET_EVENTO del pedido. Se llama
 * dentro de la misma transacción que marca el pedido como PAGADO, así que o se
 * confirman pago y entradas a la vez o ninguna de las dos cosas.
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
