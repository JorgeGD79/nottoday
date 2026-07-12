import { Worker } from "bullmq";
import { bullmqConnection } from "@/config/bullmq-connection";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { sweepAbandonedCarts } from "@/services/abandoned-cart.service";
import { ABANDONED_CART_QUEUE, abandonedCartQueue } from "./queues";

/**
 * Proceso independiente (arrancar con `npm run worker`) que:
 *   1. Programa el job repetible "sweep" con el patrón cron de
 *      ABANDONED_CART_CRON (cada 2 horas por defecto).
 *   2. Consume esa cola y ejecuta el barrido de carritos abandonados.
 *
 * Se ejecuta separado del proceso HTTP (server.ts) para que un pico de
 * checkout/tráfico público nunca compita por CPU/latencia con este trabajo
 * de fondo, y para poder escalar cada uno de forma independiente.
 */
async function bootstrapScheduler() {
  await abandonedCartQueue.upsertJobScheduler(
    "abandoned-cart-cron",
    { pattern: env.ABANDONED_CART_CRON },
    { name: "sweep" }
  );
  logger.info({ cron: env.ABANDONED_CART_CRON }, "Job scheduler de carritos abandonados registrado");
}

const worker = new Worker(
  ABANDONED_CART_QUEUE,
  async () => {
    await sweepAbandonedCarts();
  },
  { connection: bullmqConnection }
);

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Fallo al procesar el barrido de carritos abandonados");
});

bootstrapScheduler().catch((err) => {
  logger.error({ err }, "No se pudo registrar el scheduler de carritos abandonados");
  process.exit(1);
});
