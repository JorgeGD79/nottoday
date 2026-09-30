import { FastifyReply, FastifyRequest } from "fastify";
import QRCode from "qrcode";
import { z } from "zod";
import { AppError } from "@/utils/AppError";
import { TICKET_CODE_REGEX } from "@/services/ticket.service";
import { prisma } from "@/lib/prisma";
import { EventStatus, ProductStatus, ProductType } from "@prisma/client";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";

/**
 * GET /api/tickets
 *
 * Tickets de evento: son Product (productType TICKET_EVENTO, status ACTIVO)
 * ligados 1:1 a un Event, con una única variante GENERAL cuyo stockAvailable
 * es el aforo que queda (lo gestiona el evento). Reutiliza el mismo
 * Cart/Checkout/Stripe que la tienda — este
 * endpoint solo expone el catálogo, igual que /api/shop y /api/drops.
 */
export async function listTicketsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const cached = await getCached(CACHE_KEYS.tickets);
  if (cached) {
    return reply.header("X-Cache", "HIT").send(cached);
  }

  // Solo eventos publicados que no han pasado (margen de 12 h, como la agenda).
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const tickets = await prisma.product.findMany({
    where: {
      productType: ProductType.TICKET_EVENTO,
      status: ProductStatus.ACTIVO,
      event: { status: EventStatus.PUBLICADO, date: { gte: cutoff } },
    },
    include: {
      variants: { select: { id: true, size: true, stockAvailable: true } },
      event: { select: { id: true, title: true, date: true, venue: true, posterUrl: true, status: true } },
    },
    orderBy: { event: { date: "asc" } },
  });

  const payload = { tickets };
  await setCached(CACHE_KEYS.tickets, payload, CACHE_TTL_SECONDS.tickets);

  return reply.header("X-Cache", "MISS").send(payload);
}

const qrParamsSchema = z.object({ code: z.string() });

/**
 * GET /api/tickets/qr/:code — PNG del QR de una entrada.
 *
 * Lo cargan el email de confirmación y la página de seguimiento (<img src>).
 * No consulta la BD: solo dibuja el código que recibe, así que no sirve de
 * oráculo para adivinar códigos válidos. La validación real es el check-in.
 */
export async function ticketQrHandler(request: FastifyRequest, reply: FastifyReply) {
  const { code } = qrParamsSchema.parse(request.params);
  if (!TICKET_CODE_REGEX.test(code)) throw new AppError("Código no válido", 400);

  const png = await QRCode.toBuffer(code, { type: "png", width: 360, margin: 2, errorCorrectionLevel: "M" });
  return reply
    .header("Content-Type", "image/png")
    // El QR de un código nunca cambia: cacheable indefinidamente.
    .header("Cache-Control", "public, max-age=31536000, immutable")
    .send(png);
}
