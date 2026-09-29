import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { NewsletterStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditLog } from "@/services/audit-log.service";

const listQuerySchema = z.object({
  status: z.nativeEnum(NewsletterStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

/** GET /api/admin/newsletter — suscriptores paginados + contadores. */
export async function listSubscribersHandler(request: FastifyRequest, reply: FastifyReply) {
  const { status, page, pageSize } = listQuerySchema.parse(request.query);
  const where = status ? { status } : {};

  const [subscribers, total, active] = await Promise.all([
    prisma.newsletterSubscriber.findMany({
      where,
      select: { id: true, email: true, status: true, source: true, consentAt: true, unsubscribedAt: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.newsletterSubscriber.count({ where }),
    prisma.newsletterSubscriber.count({ where: { status: NewsletterStatus.ACTIVO } }),
  ]);

  return reply.send({
    subscribers,
    stats: { active },
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

// Neutraliza la inyección de fórmulas al abrir el CSV en Excel/Sheets.
const csvCell = (value: unknown) => {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/**
 * GET /api/admin/newsletter/export — CSV de suscriptores ACTIVOS (para
 * importarlo en Mailchimp/Brevo/Resend). Queda registrado en auditoría
 * porque es una extracción de datos personales.
 */
export async function exportSubscribersHandler(request: FastifyRequest, reply: FastifyReply) {
  const subscribers = await prisma.newsletterSubscriber.findMany({
    where: { status: NewsletterStatus.ACTIVO },
    select: { email: true, consentAt: true, source: true },
    orderBy: { consentAt: "asc" },
  });

  const lines = [
    ["email", "consent_at", "source"].join(","),
    ...subscribers.map((s) => [csvCell(s.email), csvCell(s.consentAt.toISOString()), csvCell(s.source)].join(",")),
  ];

  await recordAuditLog({
    userId: request.user.id,
    action: `Exportó ${subscribers.length} suscriptores de la newsletter`,
    request,
    metadata: { count: subscribers.length },
  });

  const date = new Date().toISOString().slice(0, 10);
  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="newsletter-${date}.csv"`)
    .send("﻿" + lines.join("\n"));
}
