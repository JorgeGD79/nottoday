import { buildApp } from "@/app";
import { env } from "@/config/env";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

async function main() {
  const app = await buildApp();

  // Aviso de modo inseguro: si se dan estas condiciones, la instancia NO debe
  // exponerse públicamente (es una demo/dev). Se registra en cada arranque para
  // que nunca esté silenciosamente en un estado peligroso.
  const insecureReasons: string[] = [];
  if (env.NODE_ENV !== "production") insecureReasons.push(`NODE_ENV=${env.NODE_ENV}`);
  if (env.CHECKOUT_SKIP_STRIPE) insecureReasons.push("CHECKOUT_SKIP_STRIPE=true (pedidos PAGADOS sin cobro real)");
  if (env.CORS_ORIGIN.trim() === "*") insecureReasons.push("CORS_ORIGIN=* (cualquier origen)");
  if (insecureReasons.length > 0) {
    app.log.warn(
      `⚠️  MODO INSEGURO / DEMO — NO exponer públicamente: ${insecureReasons.join(" · ")}. ` +
        `Para producción usa NODE_ENV=production con secretos reales.`
    );
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Recibida señal ${signal}, cerrando servidor...`);
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
