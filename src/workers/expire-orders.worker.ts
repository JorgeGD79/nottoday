import { Worker } from "bullmq";
import { bullmqConnection } from "@/config/bullmq-connection";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { sweepExpiredPendingOrders } from "@/services/expire-orders.service";
import { PENDING_ORDER_QUEUE, pendingOrderQueue } from "./queues";

/**
 * Proceso independiente (arrancar con `npm run worker:orders`) que:
 *   1. Programa el job repetible "sweep" con el patrón cron de
 *      PENDING_ORDER_CRON (cada 5 minutos por defecto).
 *   2. Consume esa cola y ejecuta el barrido de pedidos PENDIENTE caducados,
 *      liberando la reserva de stock de los que superaron el TTL sin pagarse.
 *
 * Se ejecuta separado del proceso HTTP (server.ts) por las mismas razones que
 * el worker de carritos abandonados: aislar el trabajo de fondo del tráfico web.
 */
async function bootstrapScheduler() {
  await pendingOrderQueue.upsertJobScheduler(
    "pending-order-cron",
    { pattern: env.PENDING_ORDER_CRON },
    { name: "sweep" }
  );
  logger.info({ cron: env.PENDING_ORDER_CRON }, "Job scheduler de expiración de pedidos registrado");
}

const worker = new Worker(
  PENDING_ORDER_QUEUE,
  async () => {
    await sweepExpiredPendingOrders();
  },
  { connection: bullmqConnection }
);

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Fallo al procesar el barrido de pedidos pendientes");
});

bootstrapScheduler().catch((err) => {
  logger.error({ err }, "No se pudo registrar el scheduler de expiración de pedidos");
  process.exit(1);
});
