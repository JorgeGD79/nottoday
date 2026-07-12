import { PrismaClient } from "@prisma/client";
import { env } from "@/config/env";

// Cliente Prisma único (singleton) reutilizado en toda la app para evitar
// agotar el pool de conexiones de Postgres bajo alta concurrencia.
export const prisma = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
