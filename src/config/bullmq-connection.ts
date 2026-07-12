import { env } from "@/config/env";

/**
 * BullMQ trae su propia copia interna de "ioredis" (versión distinta a la
 * que usamos para el cache en src/lib/redis.ts), así que pasarle nuestra
 * instancia directamente rompe la compatibilidad de tipos entre ambas copias
 * del paquete. En su lugar, le damos una URL de conexión propia: BullMQ crea
 * y gestiona su conexión interna de forma totalmente independiente.
 */
const url = new URL(env.REDIS_URL);

export const bullmqConnection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  password: url.password || undefined,
  username: url.username || undefined,
  maxRetriesPerRequest: null as null,
};
