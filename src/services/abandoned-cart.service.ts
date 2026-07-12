import { prisma } from "@/lib/prisma";
import { CartStatus } from "@prisma/client";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";

/**
 * Barrido de carritos abandonados: cualquier carrito ACTIVO que no se ha
 * tocado en las últimas N horas (ABANDONED_CART_THRESHOLD_HOURS, por defecto
 * 2) pasa a estado ABANDONADO. Se deja el hook `abandonedNotifiedAt` listo
 * para que un futuro job de email marketing sepa a quién ya se le avisó.
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
  return result.count;
}
