import path from "node:path";
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import jwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

import { env, corsOrigin, trustProxy } from "@/config/env";
import { redis } from "@/lib/redis";
import { AppError } from "@/utils/AppError";

import { authRoutes } from "@/modules/auth/auth.routes";
import { adminProductsRoutes } from "@/modules/admin/products/products.routes";
import { adminArtistsRoutes } from "@/modules/admin/artists/artists.routes";
import { adminEventsRoutes } from "@/modules/admin/events/events.routes";
import { adminDiscountsRoutes } from "@/modules/admin/discounts/discounts.routes";
import { adminBookingsRoutes } from "@/modules/admin/bookings/bookings.routes";
import { adminLogsRoutes } from "@/modules/admin/logs/logs.routes";
import { shopRoutes } from "@/modules/public/shop/shop.routes";
import { dropsRoutes } from "@/modules/public/drops/drops.routes";
import { cartRoutes } from "@/modules/public/cart/cart.routes";
import { checkoutRoutes } from "@/modules/public/checkout/checkout.routes";
import { publicBookingsRoutes } from "@/modules/public/bookings/bookings.routes";
import { publicEventsRoutes } from "@/modules/public/events/events.routes";
import { publicArtistsRoutes } from "@/modules/public/artists/artists.routes";
import { publicSessionsRoutes } from "@/modules/public/sessions/sessions.routes";
import { adminSessionsRoutes } from "@/modules/admin/sessions/sessions.routes";
import { publicShippingRoutes } from "@/modules/public/shipping/shipping.routes";
import { publicOrdersRoutes } from "@/modules/public/orders/orders.routes";
import { adminShippingRoutes } from "@/modules/admin/shipping/shipping.routes";
import { adminOrdersRoutes } from "@/modules/admin/orders/orders.routes";
import { adminUploadsRoutes } from "@/modules/admin/uploads/uploads.routes";

export async function buildApp(): Promise<FastifyInstance> {
  // Dejamos que Fastify construya su propia instancia de pino a partir de
  // opciones (en vez de inyectar la nuestra): dos copias de "pino" en el
  // árbol de dependencias generan tipos incompatibles si se pasa una instancia.
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      transport:
        env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { colorize: true } },
    },
    // Configurable: por defecto NO confía en X-Forwarded-For (evita spoofing de IP
    // y bypass del rate-limit). Detrás de un proxy/CDN se pone TRUST_PROXY=<nº de saltos>.
    trustProxy,
  });

  // --- Content-Type parser custom: conservamos el body crudo (Buffer) para
  // poder verificar la firma de los webhooks de Stripe, y lo parseamos a JSON
  // igual que haría el parser por defecto para el resto de rutas. ---
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    request.rawBody = body as Buffer;
    if (body.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body.toString("utf8")));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // --- Seguridad / plataforma ---
  // CSP relajada solo en lo que exige el frontend estático: Tailwind por CDN
  // (script remoto + config inline + estilos inyectados), Google Fonts e
  // imágenes remotas (posters/productos alojados en cualquier https).
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://js.stripe.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        // Vídeo del hero (y cualquier otro futuro) servido desde Cloudinary u
        // otro host https — mismo criterio permisivo que imgSrc.
        mediaSrc: ["'self'", "https:"],
        connectSrc: ["'self'", "https://api.stripe.com"],
        frameSrc: ["https://js.stripe.com", "https://www.youtube-nocookie.com"],
        // Endurecido: sin plugins/embeds arbitrarios, sin secuestro de <base>, sin
        // que la página se pueda enmarcar (clickjacking), y los formularios solo
        // pueden enviar al propio origen.
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        // En desarrollo se accede por http (localhost o IP de la LAN desde el móvil):
        // esta directiva forzaría todas las subresources a https y rompería css/js.
        upgradeInsecureRequests: env.NODE_ENV === "production" ? [] : null,
      },
    },
  });
  // `corsOrigin` es la lista explícita de dominios permitidos (o "*" solo fuera
  // de producción). Con credentials:true nunca debe ser comodín en prod: eso lo
  // garantiza la validación de env.ts, que aborta el arranque si CORS_ORIGIN="*".
  await app.register(cors, { origin: corsOrigin, credentials: true });
  // Store en Redis (no en memoria) para que el límite se respete de forma
  // consistente aunque el backend corra en varias instancias detrás de un balanceador.
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute", redis });
  await app.register(sensible);
  await app.register(jwt, { secret: env.JWT_SECRET });
  // Subida de imágenes del panel (multipart/form-data). Límite por archivo 10 MB.
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 10 } });

  // --- Manejador de errores global ---
  // IMPORTANTE: debe registrarse ANTES de los `app.register(...)` de las rutas.
  // Cada `register()` crea un contexto encapsulado que "congela" el
  // errorHandler vigente en ese momento; si se define después, los plugins
  // ya registrados (todas las rutas de abajo) seguirían usando el handler
  // por defecto de Fastify en vez de este.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.message, details: error.details });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Datos de entrada inválidos", details: error.flatten() });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return reply.code(409).send({ error: "Registro duplicado", details: error.meta });
      }
      if (error.code === "P2025") {
        return reply.code(404).send({ error: "Registro no encontrado" });
      }
    }
    // @fastify/rate-limit y @fastify/jwt lanzan errores con statusCode propio.
    if (typeof (error as { statusCode?: number }).statusCode === "number") {
      return reply
        .code((error as { statusCode: number }).statusCode)
        .send({ error: error.message });
    }

    request.log.error({ err: error }, "Error no controlado");
    return reply.code(500).send({ error: "Error interno del servidor" });
  });

  // --- Frontend público (SPA-less: páginas estáticas en /public) ---
  await app.register(fastifyStatic, {
    root: path.join(__dirname, "..", "public"),
    prefix: "/",
  });

  // --- API pública ---
  await app.register(shopRoutes, { prefix: "/api/shop" });
  await app.register(dropsRoutes, { prefix: "/api/drops" });
  await app.register(cartRoutes, { prefix: "/api/cart" });
  await app.register(checkoutRoutes, { prefix: "/api/checkout" });
  await app.register(publicBookingsRoutes, { prefix: "/api/bookings" });
  await app.register(publicEventsRoutes, { prefix: "/api/events" });
  await app.register(publicArtistsRoutes, { prefix: "/api/artists" });
  await app.register(publicSessionsRoutes, { prefix: "/api/sessions" });
  await app.register(publicShippingRoutes, { prefix: "/api/shipping" });
  await app.register(publicOrdersRoutes, { prefix: "/api/orders" });
  await app.register(authRoutes, { prefix: "/api/auth" });

  // --- API privada / Panel de Administración ---
  await app.register(adminProductsRoutes, { prefix: "/api/admin/products" });
  await app.register(adminArtistsRoutes, { prefix: "/api/admin/artists" });
  await app.register(adminEventsRoutes, { prefix: "/api/admin/events" });
  await app.register(adminDiscountsRoutes, { prefix: "/api/admin/discounts" });
  await app.register(adminBookingsRoutes, { prefix: "/api/admin/bookings" });
  await app.register(adminLogsRoutes, { prefix: "/api/admin/logs" });
  await app.register(adminSessionsRoutes, { prefix: "/api/admin/sessions" });
  await app.register(adminShippingRoutes, { prefix: "/api/admin/shipping" });
  await app.register(adminOrdersRoutes, { prefix: "/api/admin/orders" });
  await app.register(adminUploadsRoutes, { prefix: "/api/admin/uploads" });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
