import { DropStatus, ProductStatus, ProductType, StockNotificationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/services/email.service";
import { dropOpenEmail, lowStockEmail, restockEmail } from "@/services/email-templates";
import { effectiveDropStatus } from "@/services/drop.service";
import { variantLabel } from "@/utils/slug";

// ============================================================================
// Alertas de stock:
//   - Stock bajo (interna): al vender, si una variante cae al umbral
//     LOW_STOCK_THRESHOLD se avisa al buzón del equipo (una vez por variante
//     hasta que se reponga).
//   - Reposición (clientes): quien pidió "avísame" en una variante agotada
//     recibe un email cuando vuelve a haber unidades.
//   - Lista de espera de drops: aviso cuando el drop abre.
//
// Una notificación solo se marca como enviada si el email salió de verdad
// (con EMAILS_ENABLED=false quedan pendientes y se enviarán al activarlos).
// ============================================================================

const available = (v: { stockAvailable: number; stockReserved: number }) => v.stockAvailable - v.stockReserved;

/** Tras una venta: avisa al equipo de las variantes que han caído al umbral. */
export async function checkLowStock(variantIds: string[]) {
  if (!variantIds.length) return;
  try {
    const variants = await prisma.productVariant.findMany({
      where: {
        id: { in: variantIds },
        active: true,
        lowStockAlertedAt: null,
        product: { productType: { not: ProductType.TICKET_EVENTO } },
      },
      include: { product: { select: { name: true } } },
    });
    const low = variants.filter((v) => available(v) <= env.LOW_STOCK_THRESHOLD);
    if (!low.length) return;

    const rows = low.map((v) => ({ product: v.product.name, variant: variantLabel(v), available: available(v) }));
    logger.warn({ variants: rows }, "Stock bajo");
    if (!env.EMAIL_REPLY_TO) return;

    const sent = await sendEmail({ to: env.EMAIL_REPLY_TO, ...lowStockEmail(rows) });
    if (sent) {
      await prisma.productVariant.updateMany({
        where: { id: { in: low.map((v) => v.id) } },
        data: { lowStockAlertedAt: new Date() },
      });
    }
  } catch (err) {
    logger.error({ err }, "No se pudo comprobar el stock bajo");
  }
}

/**
 * Tras subir el stock (reposición en el panel, reembolso con devolución de
 * stock, reserva liberada): avisa a quien esperaba esas variantes y rearma
 * la alerta de stock bajo de las que ya superan el umbral.
 */
export async function notifyRestock(variantIds: string[]) {
  if (!variantIds.length) return;
  try {
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: { include: { dropMeta: true } } },
    });

    const rearm = variants.filter((v) => v.lowStockAlertedAt && available(v) > env.LOW_STOCK_THRESHOLD);
    if (rearm.length) {
      await prisma.productVariant.updateMany({
        where: { id: { in: rearm.map((v) => v.id) } },
        data: { lowStockAlertedAt: null },
      });
    }

    for (const v of variants) {
      if (!v.active || available(v) <= 0 || v.product.status !== ProductStatus.ACTIVO) continue;
      if (v.product.dropMeta && effectiveDropStatus(v.product.dropMeta) !== DropStatus.ABIERTO) continue;

      const pending = await prisma.stockNotification.findMany({
        where: {
          status: StockNotificationStatus.PENDIENTE,
          productId: v.productId,
          // La de esta variante, o las de "cualquier talla" de un producto normal
          // (en los drops, las de variante null son la lista de espera de apertura).
          OR: [{ productVariantId: v.id }, ...(v.product.dropMeta ? [] : [{ productVariantId: null }])],
        },
        take: 500,
      });

      for (const n of pending) {
        const sent = await sendEmail({
          to: n.email,
          ...restockEmail({ name: v.product.name, slug: v.product.slug, variant: variantLabel(v) }),
        });
        if (sent) {
          await prisma.stockNotification.update({
            where: { id: n.id },
            data: { status: StockNotificationStatus.NOTIFICADO, notifiedAt: new Date() },
          });
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "No se pudieron enviar los avisos de reposición");
  }
}

/**
 * Lista de espera de drops: avisa a los apuntados de los drops que ya están
 * abiertos. Lo llama el barrido periódico (worker) y el panel al abrir un drop
 * a mano; la apertura por fecha no dispara ningún evento, por eso el barrido.
 */
export async function notifyOpenedDrops() {
  const drops = await prisma.product.findMany({
    where: {
      productType: ProductType.DROP_EXCLUSIVO,
      status: ProductStatus.ACTIVO,
      dropMeta: { isNot: null },
      stockNotifications: { some: { status: StockNotificationStatus.PENDIENTE, productVariantId: null } },
    },
    include: { dropMeta: true },
  });

  let sentCount = 0;
  for (const drop of drops) {
    if (!drop.dropMeta || effectiveDropStatus(drop.dropMeta) !== DropStatus.ABIERTO) continue;
    const pending = await prisma.stockNotification.findMany({
      where: { productId: drop.id, productVariantId: null, status: StockNotificationStatus.PENDIENTE },
      take: 1000,
    });
    for (const n of pending) {
      const sent = await sendEmail({ to: n.email, ...dropOpenEmail({ name: drop.name, slug: drop.slug }) });
      if (sent) {
        sentCount++;
        await prisma.stockNotification.update({
          where: { id: n.id },
          data: { status: StockNotificationStatus.NOTIFICADO, notifiedAt: new Date() },
        });
      }
    }
  }
  if (sentCount) logger.info({ count: sentCount }, "Avisos de apertura de drop enviados");
  return sentCount;
}
