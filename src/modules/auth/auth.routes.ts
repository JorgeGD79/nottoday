import { FastifyInstance } from "fastify";
import { loginHandler, logoutHandler, meHandler } from "./auth.controller";
import { authenticate } from "@/middleware/authenticate";

export async function authRoutes(fastify: FastifyInstance) {
  // No hay auto-registro público: las cuentas de ADMIN/STAFF se crean por seed
  // (prisma/seed.ts) o directamente en la base de datos. Exponer un /register
  // permitiría a cualquiera obtener acceso al panel.

  // Rate-limit estricto solo en login: frena la fuerza bruta de credenciales
  // (el límite global de 100/min es demasiado alto para esto).
  fastify.post(
    "/login",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    loginHandler
  );
  fastify.get("/me", { preHandler: [authenticate] }, meHandler);
  fastify.post("/logout", { preHandler: [authenticate] }, logoutHandler);
}
