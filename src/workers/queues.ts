import { Queue } from "bullmq";
import { bullmqConnection } from "@/config/bullmq-connection";

export const ABANDONED_CART_QUEUE = "abandoned-cart-sweep";

// La usamos únicamente para programar el job repetible (cron); el propio
// job no lleva payload, simplemente dispara un barrido completo cada vez.
export const abandonedCartQueue = new Queue(ABANDONED_CART_QUEUE, { connection: bullmqConnection });

export const PENDING_ORDER_QUEUE = "pending-order-expiry";

// Igual que la anterior: cron sin payload que dispara el barrido de pedidos
// PENDIENTE caducados para liberar su reserva de stock.
export const pendingOrderQueue = new Queue(PENDING_ORDER_QUEUE, { connection: bullmqConnection });
