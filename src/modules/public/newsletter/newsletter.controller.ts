import { randomBytes } from "node:crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { NewsletterStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/services/email.service";
import { newsletterWelcomeEmail } from "@/services/email-templates";
import { renderNewsletterBodyWeb } from "@/services/newsletter-content";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";
import { AppError } from "@/utils/AppError";

const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  // RGPD: el consentimiento tiene que ser una acción explícita (checkbox), no implícito.
  consent: z.literal(true, { errorMap: () => ({ message: "Debes aceptar la política de privacidad" }) }),
  source: z.string().trim().max(40).optional(),
});

const newToken = () => randomBytes(24).toString("base64url");

/**
 * POST /api/newsletter/subscribe
 *
 * Alta con consentimiento registrado (fecha, IP y formulario de origen).
 * La respuesta es siempre la misma, exista o no el email, para no revelar
 * quién está suscrito. Solo se envía el email de bienvenida en altas nuevas o
 * reactivaciones, no si ya estaba dentro (evita usarlo para spamear a terceros).
 */
export async function subscribeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { email, source } = subscribeSchema.parse(request.body);

  const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } });
  let token: string | null = null;

  if (!existing) {
    const created = await prisma.newsletterSubscriber.create({
      data: {
        email,
        consentAt: new Date(),
        consentIp: request.ip,
        source: source || "newsletter",
        unsubscribeToken: newToken(),
      },
    });
    token = created.unsubscribeToken;
  } else if (existing.status === NewsletterStatus.BAJA) {
    const updated = await prisma.newsletterSubscriber.update({
      where: { id: existing.id },
      data: {
        status: NewsletterStatus.ACTIVO,
        consentAt: new Date(),
        consentIp: request.ip,
        source: source || existing.source,
        unsubscribedAt: null,
        unsubscribeToken: newToken(),
      },
    });
    token = updated.unsubscribeToken;
  }

  if (token) {
    await sendEmail({ to: email, ...newsletterWelcomeEmail(token) });
  }

  return reply.code(201).send({ ok: true });
}

const unsubscribeSchema = z.object({ token: z.string().trim().min(16).max(128) });

/**
 * POST /api/newsletter/unsubscribe — baja con el token del enlace del email.
 * Idempotente y sin revelar si el token existía.
 */
export async function unsubscribeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { token } = unsubscribeSchema.parse(request.body);
  await unsubscribeByToken(token);
  return reply.send({ ok: true });
}

/**
 * POST /api/newsletter/one-click/:token — baja en un clic desde el propio
 * cliente de correo (cabecera List-Unsubscribe-Post de las newsletters).
 */
export async function oneClickUnsubscribeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { token } = unsubscribeSchema.parse(request.params);
  await unsubscribeByToken(token);
  return reply.send({ ok: true });
}

function unsubscribeByToken(token: string) {
  return prisma.newsletterSubscriber.updateMany({
    where: { unsubscribeToken: token, status: NewsletterStatus.ACTIVO },
    data: { status: NewsletterStatus.BAJA, unsubscribedAt: new Date() },
  });
}

// ----------------------------------------------------------------------------
// Archivo público: las newsletters publicadas se leen también en la web.
// ----------------------------------------------------------------------------

/**
 * GET /api/newsletter/issues — números publicados, del más reciente al más
 * antiguo, con su número correlativo (Nº 1 = el primero que se publicó).
 */
export async function listIssuesHandler(_request: FastifyRequest, reply: FastifyReply) {
  const cached = await getCached(CACHE_KEYS.newsletterIssues);
  if (cached) return reply.header("X-Cache", "HIT").send(cached);

  const published = await prisma.newsletterCampaign.findMany({
    where: { publishedAt: { not: null } },
    select: { id: true, subject: true, preheader: true, heading: true, imageUrl: true, publishedAt: true },
    orderBy: { publishedAt: "asc" },
  });
  const issues = published.map((issue, index) => ({ ...issue, number: index + 1 })).reverse();
  const payload = { issues };
  await setCached(CACHE_KEYS.newsletterIssues, payload, CACHE_TTL_SECONDS.newsletterIssues);
  return reply.header("X-Cache", "MISS").send(payload);
}

const issueParamsSchema = z.object({ id: z.string().cuid() });

/** GET /api/newsletter/issues/:id — un número publicado, con el cuerpo ya en HTML para la web. */
export async function issueDetailHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = issueParamsSchema.parse(request.params);
  const issue = await prisma.newsletterCampaign.findFirst({
    where: { id, publishedAt: { not: null } },
    select: {
      id: true, subject: true, preheader: true, heading: true, body: true,
      imageUrl: true, ctaLabel: true, ctaUrl: true, publishedAt: true,
    },
  });
  if (!issue) throw AppError.notFound("Newsletter");
  const number = await prisma.newsletterCampaign.count({
    where: { publishedAt: { not: null, lte: issue.publishedAt! } },
  });
  const { body, ...rest } = issue;
  return reply.send({ issue: { ...rest, number, bodyHtml: renderNewsletterBodyWeb(body) } });
}
