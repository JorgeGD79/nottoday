import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { creditNotePdf, invoicePdf } from "@/services/invoice.service";
import { maskIdDocument } from "@/utils/id-document";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/services/email.service";
import { withdrawalAdminEmail, withdrawalReceiptEmail } from "@/services/email-templates";

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
      withdrawalRequestedAt: true,
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
          holderDocument: true,
          checkedInAt: true,
          event: { select: { title: true, date: true, venue: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!order) throw AppError.notFound("Pedido");

  // El DNI de las entradas nominativas nunca sale completo por esta vía pública
  // (basta con conocer el nº de pedido y el email): solo los 4 últimos caracteres.
  return reply.send({
    order: { ...order, tickets: order.tickets.map((t) => ({ ...t, holderDocument: maskIdDocument(t.holderDocument) })) },
  });
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

const withdrawSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(2).max(120),
  note: z.string().trim().max(1000).optional(),
});

/**
 * POST /api/orders/:id/withdraw — función de desistimiento online
 * (art. 11 bis de la Directiva 2011/83/UE, aplicable desde el 19/06/2026).
 *
 * Mismo acceso que el seguimiento (id + email). Registra la declaración y manda
 * al cliente el acuse de recibo con fecha y hora (soporte duradero) y a la
 * tienda el aviso interno. No reembolsa: eso se hace desde el panel al recibir
 * la devolución. Es idempotente: repetirlo devuelve la fecha de la primera vez.
 * Solo aplica a pedidos pagados con algún producto físico: las entradas para
 * una fecha concreta están excluidas del desistimiento (LGDCU art. 103.l).
 */
export async function withdrawOrderHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = paramsSchema.parse(request.params);
  const { email, name, note } = withdrawSchema.parse(request.body);

  const order = await prisma.order.findFirst({
    where: { id, email: { equals: email.trim(), mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      status: true,
      refundedAt: true,
      withdrawalRequestedAt: true,
      items: { select: { quantity: true, variantLabel: true, product: { select: { name: true, productType: true } } } },
    },
  });
  if (!order) throw AppError.notFound("Pedido");
  if (order.withdrawalRequestedAt) return reply.send({ withdrawalRequestedAt: order.withdrawalRequestedAt, alreadyRequested: true });

  const physical = order.items.filter((i) => i.product.productType !== "TICKET_EVENTO");
  if (order.status !== "PAGADO" || order.refundedAt || !physical.length) {
    throw new AppError("Este pedido no admite desistimiento online. Escríbenos y lo vemos.", 422);
  }

  // UPDATE condicional: dos envíos simultáneos no generan dos acuses.
  const now = new Date();
  const { count } = await prisma.order.updateMany({
    where: { id: order.id, withdrawalRequestedAt: null },
    data: { withdrawalRequestedAt: now, withdrawalName: name, withdrawalNote: note || null },
  });
  if (!count) {
    const current = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { withdrawalRequestedAt: true } });
    return reply.send({ withdrawalRequestedAt: current.withdrawalRequestedAt, alreadyRequested: true });
  }

  const data = { id: order.id, email: order.email, name, note: note || null, requestedAt: now, items: physical };
  await sendEmail({ to: order.email, ...withdrawalReceiptEmail(data) });
  const inbox = env.EMAIL_REPLY_TO || env.COMPANY_EMAIL;
  if (inbox) await sendEmail({ to: inbox, ...withdrawalAdminEmail(data) });
  else logger.warn({ orderId: order.id }, "Desistimiento sin buzón interno (EMAIL_REPLY_TO / COMPANY_EMAIL)");

  return reply.send({ withdrawalRequestedAt: now, alreadyRequested: false });
}
