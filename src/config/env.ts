import "dotenv/config";
import { z } from "zod";

// Valores placeholder que jamás deben usarse como secreto real en producción.
// Si JWT_SECRET contiene cualquiera de estos fragmentos, el proceso no arranca.
const WEAK_SECRET_FRAGMENTS = ["cambiar", "changeme", "dev-", "placeholder", "example", "secreto"];

// Parseo de flags booleanas desde variables de entorno (siempre strings).
// Acepta "true"/"1" como verdadero; cualquier otro valor (incl. ausencia) es falso.
const booleanFlag = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");

// Validamos el entorno una sola vez al arrancar: si falta algo crítico
// (p. ej. JWT_SECRET), preferimos que el proceso no arranque a fallar en caliente.
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().default(4000),
    // Sin comodín por defecto: en producción se exige un origen explícito (ver superRefine).
    CORS_ORIGIN: z.string().default("http://localhost:4000"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatorio"),
    REDIS_URL: z.string().min(1, "REDIS_URL es obligatorio"),

    JWT_SECRET: z.string().min(32, "JWT_SECRET debe tener al menos 32 caracteres"),
    JWT_EXPIRES_IN: z.string().default("8h"),

    STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY es obligatorio"),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    // Cloudinary (subida de imágenes del panel). Opcionales: si faltan, el
    // endpoint de subida responde un error claro en vez de tumbar el arranque.
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),

    // Solo desarrollo/pruebas: salta la llamada a Stripe en el checkout y confirma
    // el pedido como pagado directamente, para poder simular la web de punta a punta
    // sin claves de Stripe reales. PROHIBIDO en producción (ver superRefine).
    CHECKOUT_SKIP_STRIPE: booleanFlag,

    ABANDONED_CART_CRON: z.string().default("0 */2 * * *"),
    ABANDONED_CART_THRESHOLD_HOURS: z.coerce.number().default(2),

    // Expiración de pedidos PENDIENTE que nunca se pagan: libera la reserva de stock.
    // El TTL debe ser mayor que la ventana de pago típica de Stripe (~15-20 min).
    PENDING_ORDER_CRON: z.string().default("*/5 * * * *"),
    PENDING_ORDER_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  })
  .superRefine((data, ctx) => {
    // En producción endurecemos: nada de secretos placeholder ni CORS abierto,
    // y el webhook de Stripe es obligatorio (única fuente de verdad del pago).
    // Fuera de producción se toleran los valores de ejemplo para no romper el dev local.
    if (data.NODE_ENV === "production") {
      const secretLower = data.JWT_SECRET.toLowerCase();
      if (WEAK_SECRET_FRAGMENTS.some((frag) => secretLower.includes(frag))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_SECRET"],
          message:
            "JWT_SECRET parece un valor de ejemplo/placeholder. Genera uno aleatorio (p. ej. `openssl rand -hex 32`).",
        });
      }

      if (data.CORS_ORIGIN.trim() === "*") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CORS_ORIGIN"],
          message: "CORS_ORIGIN no puede ser '*' en producción. Indica el/los dominio(s) reales del frontend.",
        });
      }
      if (!data.STRIPE_WEBHOOK_SECRET || data.STRIPE_WEBHOOK_SECRET.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["STRIPE_WEBHOOK_SECRET"],
          message:
            "STRIPE_WEBHOOK_SECRET es obligatorio en producción: sin él ningún pago puede confirmarse.",
        });
      }
      if (data.CHECKOUT_SKIP_STRIPE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CHECKOUT_SKIP_STRIPE"],
          message:
            "CHECKOUT_SKIP_STRIPE no puede estar activo en producción: saltaría el cobro real y confirmaría pedidos sin pagar.",
        });
      }
    }
  });

export const env = envSchema.parse(process.env);
export type Env = typeof env;

/**
 * Orígenes permitidos por CORS, admitiendo una lista separada por comas.
 * `*` (solo válido fuera de producción) se devuelve como string para que
 * @fastify/cors lo interprete como comodín.
 */
export const corsOrigin: string | string[] =
  env.CORS_ORIGIN.trim() === "*"
    ? "*"
    : env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
