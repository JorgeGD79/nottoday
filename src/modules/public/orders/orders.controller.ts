import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { creditNotePdf, invoicePdf } from "@/services/invoice.service";

const paramsSchema = z.object({ id: z.string().cuid() });
const querySchema = z.object({ email: z.string().email() });

/**
 * GET /api/orders/:id?email=...
 *
 * Seguimiento público de pedido. Sin cuentas de usuario, la "autenticación"
 * es el par id (cuid no adivinable) + email de compra: si no coinciden ambos,
 * 404 genérico sin revelar si el pedido existe. Se expone solo el subconjunto
 * necesario para el timeline — nunca la dirección postal completa ni el teléfono.
 * Incluye las entradas del pedido (con su código) para mostrar los QR: quien
 * tiene id + email es el comprador, el mismo que las recibe por correo.
 */
export async function trackOrderHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = paramsSchema.parse(request.params);
  const { email } = querySchema.parse(request.query);

  const order = await prisma.order.findFirst({
    where: { id, email: { equals: email.trim(), mode: "insensitive" } },
    select: {
      id: true,
      status: true,
      fulfillmentStatus: true,
      trackingCode: true,
      createdAt: true,
      updatedAt: true,
      subtotal: true,
      discountAmount: true,
      shippingCost: true,
      total: true,
      taxAmount: true,
      taxExempt: true,
      invoiceNumber: true,
      creditNoteNumber: true,
      shippingMethodName: true,
      shippingCity: true,
      shippingCountry: true,
      items: {
        select: {
          quantity: true,
          unitPrice: true,
          variantLabel: true,
          product: { select: { name: true, productType: true } },
          productVariant: { select: { size: true } },
        },
      },
      tickets: {
        select: {
          code: true,
          status: true,
          holderName: true,
          checkedInAt: true,
          event: { select: { title: true, date: true, venue: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!order) throw AppError.notFound("Pedido");

  return reply.send({ order });
}

/**
 * GET /api/orders/:id/invoice?email=... (y /credit-note) — PDF de la factura.
 * Mismo control de acceso que el seguimiento: id del pedido + email de compra.
 */
export async function invoiceHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = paramsSchema.parse(request.params);
  const { email } = querySchema.parse(request.query);
  return sendPdf(reply, await invoicePdf(id, email));
}

export async function creditNoteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = paramsSchema.parse(request.params);
  const { email } = querySchema.parse(request.query);
  return sendPdf(reply, await creditNotePdf(id, email));
}

export function sendPdf(reply: FastifyReply, { filename, pdf }: { filename: string; pdf: Buffer }) {
  return reply
    .header("Content-Type", "application/pdf")
    .header("Content-Disposition", `inline; filename="${filename}"`)
    .header("Cache-Control", "private, no-store")
    .send(pdf);
}
