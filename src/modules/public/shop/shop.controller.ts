import { createHash } from "node:crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { DropStatus, Prisma, ProductStatus, ProductType, StockNotificationStatus } from "@prisma/client";
import { AppError } from "@/utils/AppError";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";
import { effectiveDropStatus } from "@/services/drop.service";
import { normalizeSearch } from "@/utils/slug";

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(60).default(24),
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(80).optional(),
  size: z.string().trim().max(40).optional(),
  color: z.string().trim().max(40).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  inStock: z.enum(["true", "false"]).optional(),
  sort: z.enum(["latest", "price-asc", "price-desc", "name"]).default("latest"),
});

// Solo variantes a la venta, en el orden que fijó el admin.
const publicVariants = {
  where: { active: true },
  select: { id: true, size: true, color: true, stockAvailable: true },
  orderBy: { sortOrder: "asc" },
} satisfies Prisma.Product$variantsArgs;

const ORDER_BY: Record<string, Prisma.ProductOrderByWithRelationInput> = {
  latest: { createdAt: "desc" },
  "price-asc": { price: "asc" },
  "price-desc": { price: "desc" },
  name: { name: "asc" },
};

/**
 * GET /api/shop
 *
 * Catálogo general (TIENDA_GENERAL, ACTIVO) con búsqueda y filtros:
 *   q          texto en nombre, descripción o categoría (sin acentos, por palabras)
 *   category   slug de categoría
 *   size/color variante activa con esa talla/color
 *   min/maxPrice, inStock, sort (latest | price-asc | price-desc | name)
 * Se cachea por combinación de filtros con TTL corto; cualquier cambio de
 * catálogo en el panel invalida todo "cache:shop:*".
 */
export async function listShopProductsHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = listQuerySchema.parse(request.query);
  const { page, pageSize, q, category, size, color, minPrice, maxPrice, inStock, sort } = query;
  const cacheKey = CACHE_KEYS.shop(createHash("sha1").update(JSON.stringify(query)).digest("hex"));

  const cached = await getCached(cacheKey);
  if (cached) {
    return reply.header("X-Cache", "HIT").send(cached);
  }

  const variantFilters: Prisma.ProductVariantWhereInput[] = [];
  if (size) variantFilters.push({ size: { equals: size, mode: "insensitive" } });
  if (color) variantFilters.push({ color: { equals: color, mode: "insensitive" } });
  if (inStock === "true") variantFilters.push({ stockAvailable: { gt: 0 } });

  const where: Prisma.ProductWhereInput = {
    productType: ProductType.TIENDA_GENERAL,
    status: ProductStatus.ACTIVO,
    ...(category ? { category: { slug: category } } : {}),
    ...(minPrice !== undefined || maxPrice !== undefined
      ? { price: { ...(minPrice !== undefined ? { gte: minPrice } : {}), ...(maxPrice !== undefined ? { lte: maxPrice } : {}) } }
      : {}),
    ...(variantFilters.length ? { variants: { some: { active: true, AND: variantFilters } } } : {}),
    // Cada palabra debe aparecer (sin acentos ni mayúsculas): "sudadera negra".
    ...(q
      ? { AND: normalizeSearch(q).split(" ").filter(Boolean).map((word) => ({ searchText: { contains: word } })) }
      : {}),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      // El frontend necesita el id de la variante para poder añadirla al carrito.
      include: { variants: publicVariants, category: { select: { name: true, slug: true } } },
      orderBy: [ORDER_BY[sort], { id: "asc" }],
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

/**
 * GET /api/shop/facets — opciones de los filtros de la tienda: categorías con
 * productos, tallas y colores en venta, y rango de precios.
 */
export async function shopFacetsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const cached = await getCached(CACHE_KEYS.shopFacets);
  if (cached) return reply.header("X-Cache", "HIT").send(cached);

  const baseWhere = { productType: ProductType.TIENDA_GENERAL, status: ProductStatus.ACTIVO };
  const [categories, variants, price] = await Promise.all([
    prisma.category.findMany({
      where: { products: { some: baseWhere } },
      select: { name: true, slug: true, _count: { select: { products: { where: baseWhere } } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.productVariant.findMany({
      where: { active: true, product: baseWhere },
      select: { size: true, color: true, sortOrder: true },
    }),
    prisma.product.aggregate({ where: baseWhere, _min: { price: true }, _max: { price: true } }),
  ]);

  // Tallas en su orden natural (el menor sortOrder con el que aparecen).
  const sizeOrder = new Map<string, number>();
  for (const v of variants) {
    sizeOrder.set(v.size, Math.min(sizeOrder.get(v.size) ?? Infinity, v.sortOrder));
  }
  const payload = {
    categories: categories.map((c) => ({ name: c.name, slug: c.slug, count: c._count.products })),
    sizes: [...sizeOrder.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([s]) => s),
    colors: [...new Set(variants.map((v) => v.color).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    price: { min: Number(price._min.price ?? 0), max: Number(price._max.price ?? 0) },
  };
  await setCached(CACHE_KEYS.shopFacets, payload, CACHE_TTL_SECONDS.shop);
  return reply.header("X-Cache", "MISS").send(payload);
}

/**
 * Ficha pública de un producto (tienda o drop) por slug. La usan la página
 * /producto/:slug (que además la renderiza en servidor para SEO) y su JS.
 */
export async function findPublicProduct(slug: string) {
  const cached = await getCached<{ product: unknown }>(CACHE_KEYS.shopProduct(slug));
  if (cached) return cached.product as Awaited<ReturnType<typeof loadPublicProduct>>;
  const product = await loadPublicProduct(slug);
  if (product) await setCached(CACHE_KEYS.shopProduct(slug), { product }, CACHE_TTL_SECONDS.shop);
  return product;
}

async function loadPublicProduct(slug: string) {
  const product = await prisma.product.findFirst({
    where: {
      slug,
      productType: { in: [ProductType.TIENDA_GENERAL, ProductType.DROP_EXCLUSIVO] },
      status: { in: [ProductStatus.ACTIVO, ProductStatus.AGOTADO] },
    },
    include: {
      variants: publicVariants,
      dropMeta: true,
      category: { select: { name: true, slug: true } },
    },
  });
  if (!product) return null;
  return {
    ...product,
    dropMeta: product.dropMeta
      ? { ...product.dropMeta, dropStatus: effectiveDropStatus(product.dropMeta) }
      : null,
  };
}

const slugParams = z.object({ slug: z.string().trim().max(120) });

export async function productDetailHandler(request: FastifyRequest, reply: FastifyReply) {
  const { slug } = slugParams.parse(request.params);
  const product = await findPublicProduct(slug);
  if (!product) throw AppError.notFound("Producto");
  return reply.send({ product });
}

const notifySchema = z.object({
  productId: z.string().cuid(),
  productVariantId: z.string().cuid().optional(),
  email: z.string().trim().toLowerCase().email().max(254),
  consent: z.literal(true, { errorMap: () => ({ message: "Debes aceptar que te escribamos para el aviso" }) }),
});

/**
 * POST /api/shop/notify — "Avísame".
 *   - Con variante: reposición de esa talla/color agotada.
 *   - Sin variante en un drop que no ha abierto: lista de espera de apertura.
 *   - Sin variante en un producto normal agotado: cualquier talla que vuelva.
 * Respuesta idéntica exista o no ya el aviso (no revela quién se apuntó).
 */
export async function notifyMeHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = notifySchema.parse(request.body);

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: { variants: { where: { active: true } }, dropMeta: true },
  });
  if (!product || product.productType === ProductType.TICKET_EVENTO || product.status === ProductStatus.BORRADOR) {
    throw AppError.notFound("Producto");
  }
  const available = (v: { stockAvailable: number; stockReserved: number }) => v.stockAvailable - v.stockReserved;
  const dropOpen = !product.dropMeta || effectiveDropStatus(product.dropMeta) === DropStatus.ABIERTO;

  if (input.productVariantId) {
    const variant = product.variants.find((v) => v.id === input.productVariantId);
    if (!variant) throw AppError.notFound("Variante de producto");
    if (dropOpen && available(variant) > 0) throw new AppError("Esa talla tiene stock: puedes comprarla ya", 422);
  } else if (dropOpen && product.variants.some((v) => available(v) > 0)) {
    throw new AppError("Este producto tiene stock: elige tu talla", 422);
  }

  const existing = await prisma.stockNotification.findFirst({
    where: {
      email: input.email,
      productId: input.productId,
      productVariantId: input.productVariantId ?? null,
      status: StockNotificationStatus.PENDIENTE,
    },
  });
  if (!existing) {
    await prisma.stockNotification.create({
      data: {
        email: input.email,
        productId: input.productId,
        productVariantId: input.productVariantId ?? null,
        consentIp: request.ip,
      },
    });
  }
  return reply.code(201).send({ ok: true });
}
