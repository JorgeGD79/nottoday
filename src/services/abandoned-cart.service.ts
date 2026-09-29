import { prisma } from "@/lib/prisma";
import { CartStatus } from "@prisma/client";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/services/email.service";
import { abandonedCartEmail } from "@/services/email-templates";

/**
 * Barrido de carritos abandonados: cualquier carrito ACTIVO que no se ha
 * tocado en las últimas N horas (ABANDONED_CART_THRESHOLD_HOURS, por defecto
 * 2) pasa a estado ABANDONADO. Después se recuerda por email a los que dejaron
 * su correo (ver sendAbandonedCartReminders).
 */
export async function sweepAbandonedCarts() {
  const threshold = new Date(Date.now() - env.ABANDONED_CART_THRESHOLD_HOURS * 60 * 60 * 1000);

  const result = await prisma.cart.updateMany({
    where: {
      status: CartStatus.ACTIVO,
      updatedAt: { lt: threshold },
      items: { some: {} }, // ignoramos carritos vacíos, no son "abandono" real
    },
    data: { status: CartStatus.ABANDONADO },
  });

  logger.info({ count: result.count }, "Barrido de carritos abandonados completado");
  const reminded = await sendAbandonedCartReminders();
  return { abandoned: result.count, reminded };
}

/**
 * Un único recordatorio por carrito abandonado con email (el checkout lo
 * guarda en cuanto el cliente lo escribe), solo si es reciente. El enlace
 * lleva al checkout con el carrito restaurado.
 *
 * `abandonedNotifiedAt` solo se marca si el email salió de verdad: con
 * EMAILS_ENABLED=false los carritos siguen pendientes de recordatorio.
 * Si el cliente vuelve a añadir algo, add-to-cart lo pone a null (rearmado).
 */
export async function sendAbandonedCartReminders() {
  const since = new Date(Date.now() - env.ABANDONED_CART_REMINDER_MAX_AGE_DAYS * 86400 * 1000);
  const carts = await prisma.cart.findMany({
    where: {
      status: CartStatus.ABANDONADO,
      email: { not: null },
      abandonedNotifiedAt: null,
      updatedAt: { gte: since },
      items: { some: {} },
    },
    include: {
      items: {
        include: {
          product: { select: { name: true, price: true } },
          productVariant: { select: { size: true, color: true } },
        },
      },
    },
    take: 200,
  });

  let sent = 0;
  for (const cart of carts) {
    const ok = await sendEmail({ to: cart.email!, ...abandonedCartEmail(cart) });
    if (ok) {
      sent++;
      // updatedAt se conserva: no queremos que el recordatorio "rejuvenezca" el carrito.
      await prisma.cart.update({
        where: { id: cart.id },
        data: { abandonedNotifiedAt: new Date(), updatedAt: cart.updatedAt },
      });
    }
  }
  if (carts.length) logger.info({ candidates: carts.length, sent }, "Recordatorios de carrito abandonado");
  return sent;
}
