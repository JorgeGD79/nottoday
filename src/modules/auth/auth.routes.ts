import { FastifyInstance } from "fastify";
import { loginHandler, meHandler } from "./auth.controller";
import { authenticate } from "@/middleware/authenticate";

export async function authRoutes(fastify: FastifyInstance) {
  // No hay auto-registro público: las cuentas de ADMIN/STAFF se crean por seed
  // (prisma/seed.ts) o directamente en la base de datos. Exponer un /register
  // permitiría a cualquiera obtener acceso al panel.
  fastify.post("/login", loginHandler);
  fastify.get("/me", { preHandler: [authenticate] }, meHandler);
}
