import { randomBytes } from "node:crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { NewsletterStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/services/email.service";
import { newsletterWelcomeEmail } from "@/services/email-templates";

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
  await prisma.newsletterSubscriber.updateMany({
    where: { unsubscribeToken: token, status: NewsletterStatus.ACTIVO },
    data: { status: NewsletterStatus.BAJA, unsubscribedAt: new Date() },
  });
  return reply.send({ ok: true });
}
