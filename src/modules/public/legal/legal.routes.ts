import { FastifyInstance } from "fastify";
import { env } from "@/config/env";

/**
 * GET /api/legal — datos del titular de la web (LSSI art. 10).
 *
 * Salen de las mismas variables COMPANY_* que las facturas, así que basta con
 * rellenarlas una vez en el entorno para que el aviso legal, las condiciones,
 * la privacidad y el checkout muestren lo mismo que la factura.
 */
export async function publicLegalRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (_request, reply) =>
    reply.header("Cache-Control", "public, max-age=300").send({
      name: env.COMPANY_NAME,
      taxId: env.COMPANY_TAX_ID,
      address: env.COMPANY_ADDRESS,
      email: env.COMPANY_EMAIL || env.EMAIL_REPLY_TO || "",
      registry: env.COMPANY_REGISTRY,
    })
  );
}
