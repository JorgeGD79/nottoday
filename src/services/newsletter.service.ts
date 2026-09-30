import { NewsletterCampaignStatus, NewsletterDeliveryStatus, NewsletterStatus } from "@prisma/client";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { sendEmail } from "@/services/email.service";
import { NewsletterCampaignContent, newsletterCampaignEmail } from "@/services/email-templates";
import { CACHE_KEYS } from "@/services/cache.service";
import { redis } from "@/lib/redis";

/** Invalida el archivo público de newsletters (tras publicar, retirar o editar). */
export async function invalidateNewsletterIssuesCache() {
  await redis.del(CACHE_KEYS.newsletterIssues);
}

// ============================================================================
// Envío de campañas de newsletter.
//
// Al lanzar una campaña se fija la lista de destinatarios (una NewsletterDelivery
// PENDIENTE por suscriptor activo) y se envía uno a uno, con una pausa entre
// correos, dentro del propio proceso web (los workers son opcionales en el
// despliegue). Cada entrega se "reclama" con un UPDATE condicional antes de
// enviarla, así dos procesos (o una reanudación) nunca mandan el mismo correo dos
// veces. Si el servidor se reinicia a mitad, resumeNewsletterCampaigns() continúa
// con las pendientes.
// ============================================================================

const BATCH_SIZE = 50;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Campañas que este proceso está enviando ahora mismo.
const running = new Set<string>();

/** Por qué no se pueden enviar newsletters ahora mismo (null = se puede). */
export function newsletterSendingBlockedReason(): string | null {
  if (!env.NEWSLETTER_SENDING_ENABLED) {
    return "El envío de newsletters está desactivado (NEWSLETTER_SENDING_ENABLED=false)";
  }
  if (!env.EMAILS_ENABLED || !env.RESEND_API_KEY) {
    return "El correo no está configurado (EMAILS_ENABLED y RESEND_API_KEY)";
  }
  return null;
}

function assertSendingEnabled() {
  const reason = newsletterSendingBlockedReason();
  if (reason) throw AppError.conflict(reason);
}

/** Correo de prueba de la campaña al email indicado (el del administrador). */
export async function sendCampaignTest(campaign: NewsletterCampaignContent & { id: string }, to: string) {
  assertSendingEnabled();
  const sent = await sendEmail({ to, ...newsletterCampaignEmail({ ...campaign, subject: `[PRUEBA] ${campaign.subject}` }, null) });
  if (!sent) throw new AppError("No se pudo enviar el correo de prueba (revisa el log)", 502);
  await prisma.newsletterCampaign.update({ where: { id: campaign.id }, data: { testSentAt: new Date() } });
}

/**
 * Lanza el envío de una campaña en BORRADOR a todos los suscriptores activos.
 * Devuelve el número de destinatarios; el envío sigue en segundo plano.
 */
export async function startCampaign(campaignId: string) {
  assertSendingEnabled();

  const recipients = await prisma.$transaction(async (tx) => {
    // Paso BORRADOR -> ENVIANDO condicional: un doble clic no lanza dos envíos.
    const claim = await tx.newsletterCampaign.updateMany({
      where: { id: campaignId, status: NewsletterCampaignStatus.BORRADOR },
      data: { status: NewsletterCampaignStatus.ENVIANDO, startedAt: new Date() },
    });
    if (claim.count === 0) throw AppError.conflict("La campaña ya se ha enviado o se está enviando");

    const subscribers = await tx.newsletterSubscriber.findMany({
      where: { status: NewsletterStatus.ACTIVO },
      select: { id: true },
    });
    if (!subscribers.length) throw AppError.conflict("No hay suscriptores activos");

    await tx.newsletterDelivery.createMany({
      data: subscribers.map((s) => ({ campaignId, subscriberId: s.id })),
      skipDuplicates: true,
    });
    // Lo que se envía por correo queda también en el archivo de la web.
    const current = await tx.newsletterCampaign.findUniqueOrThrow({ where: { id: campaignId }, select: { publishedAt: true } });
    await tx.newsletterCampaign.update({
      where: { id: campaignId },
      data: { recipientCount: subscribers.length, publishedAt: current.publishedAt ?? new Date() },
    });
    return subscribers.length;
  });

  await invalidateNewsletterIssuesCache();
  void runCampaign(campaignId);
  return recipients;
}

/** Envía las entregas pendientes de una campaña ENVIANDO hasta acabarlas. */
async function runCampaign(campaignId: string) {
  if (running.has(campaignId)) return;
  running.add(campaignId);
  try {
    const campaign = await prisma.newsletterCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.status !== NewsletterCampaignStatus.ENVIANDO) return;

    for (;;) {
      // Si alguien apaga el interruptor a mitad, se para (las pendientes quedan
      // para cuando se vuelva a activar y se reanude).
      if (newsletterSendingBlockedReason()) {
        logger.warn({ campaignId }, "Envío de newsletter pausado: el envío está desactivado");
        return;
      }

      const batch = await prisma.newsletterDelivery.findMany({
        where: { campaignId, status: NewsletterDeliveryStatus.PENDIENTE },
        include: { subscriber: { select: { email: true, status: true, unsubscribeToken: true } } },
        take: BATCH_SIZE,
      });
      if (!batch.length) break;

      for (const delivery of batch) {
        const claim = await prisma.newsletterDelivery.updateMany({
          where: { id: delivery.id, status: NewsletterDeliveryStatus.PENDIENTE },
          data: { status: NewsletterDeliveryStatus.ENVIANDO },
        });
        if (claim.count === 0) continue;

        const { subscriber } = delivery;
        if (subscriber.status !== NewsletterStatus.ACTIVO) {
          await prisma.newsletterDelivery.update({
            where: { id: delivery.id },
            data: { status: NewsletterDeliveryStatus.OMITIDO },
          });
          continue;
        }

        const sent = await sendEmail({ to: subscriber.email, ...newsletterCampaignEmail(campaign, subscriber.unsubscribeToken) });
        await prisma.newsletterDelivery.update({
          where: { id: delivery.id },
          data: sent
            ? { status: NewsletterDeliveryStatus.ENVIADO, sentAt: new Date() }
            : { status: NewsletterDeliveryStatus.FALLIDO, error: "El proveedor rechazó el correo (ver log)" },
        });
        if (env.NEWSLETTER_SEND_INTERVAL_MS) await sleep(env.NEWSLETTER_SEND_INTERVAL_MS);
      }
    }

    await prisma.newsletterCampaign.update({
      where: { id: campaignId },
      data: { status: NewsletterCampaignStatus.ENVIADA, sentAt: new Date() },
    });
    logger.info({ campaignId }, "Newsletter enviada");
  } catch (err) {
    logger.error({ err, campaignId }, "Fallo enviando la newsletter (se puede reanudar)");
  } finally {
    running.delete(campaignId);
  }
}

/**
 * Reanuda las campañas que quedaron a medias (reinicio del servidor o envío
 * pausado). Las entregas que estaban "ENVIANDO" al caer el proceso no se
 * reintentan: no se sabe si el correo salió y es preferible no duplicarlo.
 */
export async function resumeNewsletterCampaigns(campaignId?: string) {
  if (newsletterSendingBlockedReason()) return 0;
  const campaigns = await prisma.newsletterCampaign.findMany({
    where: { status: NewsletterCampaignStatus.ENVIANDO, ...(campaignId ? { id: campaignId } : {}) },
    select: { id: true },
  });
  for (const { id } of campaigns) {
    if (running.has(id)) continue;
    await prisma.newsletterDelivery.updateMany({
      where: { campaignId: id, status: NewsletterDeliveryStatus.ENVIANDO },
      data: { status: NewsletterDeliveryStatus.FALLIDO, error: "Envío interrumpido: no se reintenta para no duplicar" },
    });
    void runCampaign(id);
  }
  return campaigns.length;
}

/** Recuento de entregas por estado de varias campañas. */
export async function deliveryStats(campaignIds: string[]) {
  const grouped = await prisma.newsletterDelivery.groupBy({
    by: ["campaignId", "status"],
    where: { campaignId: { in: campaignIds } },
    _count: { _all: true },
  });
  const stats = new Map<string, Record<NewsletterDeliveryStatus, number>>();
  for (const id of campaignIds) {
    stats.set(id, { PENDIENTE: 0, ENVIANDO: 0, ENVIADO: 0, FALLIDO: 0, OMITIDO: 0 });
  }
  for (const g of grouped) stats.get(g.campaignId)![g.status] = g._count._all;
  return stats;
}
