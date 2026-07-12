import Redis from "ioredis";
import { env } from "@/config/env";

// Conexión Redis compartida: cache de catálogo (drops/shop) y backend de colas BullMQ.
// maxRetriesPerRequest: null es requerido por BullMQ para sus propias conexiones,
// lo aplicamos aquí también para mantener un único patrón de conexión resiliente.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redis.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[redis] error de conexión:", err.message);
});
