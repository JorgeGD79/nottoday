import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ProductStatus, ProductType } from "@prisma/client";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(60).default(24),
});

/**
 * GET /api/shop
 *
 * Catálogo general (productType = TIENDA_GENERAL, status = ACTIVO), consulta
 * directa a base de datos: es tráfico estable, no justifica la complejidad
 * de invalidación de cache que sí necesita /api/drops en su ventana de hype.
 * Se cachea igualmente unos segundos para amortiguar picos, con TTL corto.
 */
export async function listShopProductsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { page, pageSize } = listQuerySchema.parse(request.query);
  const cacheKey = CACHE_KEYS.shop(page, pageSize);

  const cached = await getCached(cacheKey);
  if (cached) {
    return reply.header("X-Cache", "HIT").send(cached);
  }

  const where = { productType: ProductType.TIENDA_GENERAL, status: ProductStatus.ACTIVO };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      // El frontend necesita el id de la variante para poder añadirla al carrito.
      include: { variants: { select: { id: true, size: true, stockAvailable: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  const payload = {
    products,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };

  await setCached(cacheKey, payload, CACHE_TTL_SECONDS.shop);

  return reply.header("X-Cache", "MISS").send(payload);
}
