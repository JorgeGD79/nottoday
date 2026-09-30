import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { NewsletterCampaignStatus, NewsletterStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { recordAuditLog } from "@/services/audit-log.service";
import { newsletterCampaignEmail } from "@/services/email-templates";
import {
  deliveryStats,
  invalidateNewsletterIssuesCache,
  newsletterSendingBlockedReason,
  resumeNewsletterCampaigns,
  sendCampaignTest,
  startCampaign,
} from "@/services/newsletter.service";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => v || null);

// Solo enlaces http(s): "javascript:..." también pasa por URL válida, y estos
// enlaces acaban en los correos y en el archivo público de la web.
const webUrl = z
  .string()
  .trim()
  .url()
  .refine((v) => /^https?:\/\//i.test(v), { message: "El enlace debe empezar por http:// o https://" })
  .optional()
  .or(z.literal(""))
  .transform((v) => v || null);

const campaignSchema = z
  .object({
    subject: z.string().trim().min(3).max(150),
    preheader: optionalText(150),
    heading: z.string().trim().min(2).max(150),
    body: z.string().trim().min(1).max(20_000),
    imageUrl: webUrl,
    ctaLabel: optionalText(40),
    ctaUrl: webUrl,
  })
  .refine((c) => !c.ctaLabel === !c.ctaUrl, {
    message: "El botón necesita texto y enlace (o ninguno de los dos)",
    path: ["ctaUrl"],
  });

const idParams = z.object({ id: z.string().cuid() });

async function findCampaign(id: string) {
  const campaign = await prisma.newsletterCampaign.findUnique({ where: { id } });
  if (!campaign) throw AppError.notFound("Campaña");
  return campaign;
}

function assertDraft(campaign: { status: NewsletterCampaignStatus }) {
  if (campaign.status !== NewsletterCampaignStatus.BORRADOR) {
    throw AppError.conflict("Una campaña enviada no se puede modificar: duplícala para crear otra");
  }
}

/** GET /api/admin/newsletter/campaigns — campañas con el recuento de entregas. */
export async function listCampaignsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const [campaigns, activeSubscribers] = await Promise.all([
    prisma.newsletterCampaign.findMany({
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } } },
      take: 200,
    }),
    prisma.newsletterSubscriber.count({ where: { status: NewsletterStatus.ACTIVO } }),
  ]);
  const stats = await deliveryStats(campaigns.map((c) => c.id));
  return reply.send({
    campaigns: campaigns.map((c) => ({ ...c, deliveries: stats.get(c.id) })),
    activeSubscribers,
    // null = se puede enviar; si no, el motivo (el panel lo enseña).
    sendingBlockedReason: newsletterSendingBlockedReason(),
  });
}

export async function createCampaignHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = campaignSchema.parse(request.body);
  const campaign = await prisma.newsletterCampaign.create({ data: { ...input, createdById: request.user.id } });
  await recordAuditLog({
    userId: request.user.id,
    action: `Creó la campaña de newsletter "${campaign.subject}"`,
    request,
    metadata: { campaignId: campaign.id },
  });
  return reply.code(201).send({ campaign });
}

export async function updateCampaignHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = idParams.parse(request.params);
  const input = campaignSchema.parse(request.body);
  assertDraft(await findCampaign(id));
  const campaign = await prisma.newsletterCampaign.update({ where: { id }, data: input });
  // Un borrador publicado en la web se ve con los cambios al momento.
  if (campaign.publishedAt) await invalidateNewsletterIssuesCache();
  return reply.send({ campaign });
}

export async function deleteCampaignHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = idParams.parse(request.params);
  const campaign = await findCampaign(id);
  // Las enviadas se conservan: son el registro de qué se mandó y a cuántos.
  assertDraft(campaign);
  await prisma.newsletterCampaign.delete({ where: { id } });
  if (campaign.publishedAt) await invalidateNewsletterIssuesCache();
  await recordAuditLog({
    userId: request.user.id,
    action: `Eliminó el borrador de newsletter "${campaign.subject}"`,
    request,
    metadata: { campaignId: id },
  });
  return reply.code(204).send();
}

/** POST /api/admin/newsletter/campaigns/:id/duplicate — nuevo borrador con el mismo contenido. */
export async function duplicateCampaignHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = idParams.parse(request.params);
  const { subject, preheader, heading, body, imageUrl, ctaLabel, ctaUrl } = await findCampaign(id);
  const campaign = await prisma.newsletterCampaign.create({
    data: { subject, preheader, heading, body, imageUrl, ctaLabel, ctaUrl, createdById: request.user.id },
  });
  return reply.code(201).send({ campaign });
}

/**
 * POST /api/admin/newsletter/campaigns/preview — HTML del email tal cual saldría,
 * a partir del contenido del editor (sin necesidad de guardarlo antes).
 */
export async function previewCampaignHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = campaignSchema.parse(request.body);
  const email = newsletterCampaignEmail(input, null);
  return reply.send({ subject: email.subject, html: email.html, text: email.text });
}

/** POST /api/admin/newsletter/campaigns/:id/test — prueba al email del administrador. */
export async function testCampaignHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = idParams.parse(request.params);
  const campaign = await findCampaign(id);
  await sendCampaignTest(campaign, request.user.email);
  return reply.send({ ok: true, to: request.user.email });
}

/** POST /api/admin/newsletter/campaigns/:id/send — lanza el envío a todos los activos. */
export async function sendCampaignHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = idParams.parse(request.params);
  const campaign = await findCampaign(id);
  assertDraft(campaign);
  const recipients = await startCampaign(id);
  await recordAuditLog({
    userId: request.user.id,
    action: `Lanzó el envío de la newsletter "${campaign.subject}" a ${recipients} suscriptores`,
    request,
    metadata: { campaignId: id, recipients },
  });
  return reply.code(202).send({ ok: true, recipients });
}

/**
 * POST /api/admin/newsletter/campaigns/:id/publish — la muestra en el archivo de
 * newsletter.html (sin enviar ningún correo). Sirve también con el envío desactivado.
 */
export async function publishCampaignHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = idParams.parse(request.params);
  const existing = await findCampaign(id);
  const campaign = await prisma.newsletterCampaign.update({
    where: { id },
    data: { publishedAt: existing.publishedAt ?? new Date() },
  });
  await invalidateNewsletterIssuesCache();
  await recordAuditLog({
    userId: request.user.id,
    action: `Publicó en la web la newsletter "${campaign.subject}"`,
    request,
    metadata: { campaignId: id },
  });
  return reply.send({ campaign });
}

/** POST /api/admin/newsletter/campaigns/:id/unpublish — la retira del archivo de la web. */
export async function unpublishCampaignHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = idParams.parse(request.params);
  await findCampaign(id);
  const campaign = await prisma.newsletterCampaign.update({ where: { id }, data: { publishedAt: null } });
  await invalidateNewsletterIssuesCache();
  await recordAuditLog({
    userId: request.user.id,
    action: `Retiró de la web la newsletter "${campaign.subject}"`,
    request,
    metadata: { campaignId: id },
  });
  return reply.send({ campaign });
}

/** POST /api/admin/newsletter/campaigns/:id/resume — continúa un envío interrumpido. */
export async function resumeCampaignHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = idParams.parse(request.params);
  const campaign = await findCampaign(id);
  if (campaign.status !== NewsletterCampaignStatus.ENVIANDO) throw AppError.conflict("Esta campaña no está a medio enviar");
  const reason = newsletterSendingBlockedReason();
  if (reason) throw AppError.conflict(reason);
  await resumeNewsletterCampaigns(id);
  return reply.send({ ok: true });
}
