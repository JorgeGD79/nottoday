import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";
import { normalizeSearch, uniqueSlug } from "@/utils/slug";
import { DropStatus, Prisma, ProductType, StockNotificationStatus } from "@prisma/client";
import { notifyOpenedDrops, notifyRestock } from "@/services/stock-alerts.service";
import { CreateProductInput, UpdateProductInput } from "./products.schema";

type Tx = Prisma.TransactionClient;

const productInclude = {
  variants: { orderBy: [{ active: "desc" }, { sortOrder: "asc" }] },
  dropMeta: true,
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductInclude;

/** Recalcula el texto de búsqueda (nombre + descripción + categoría) de un producto. */
export async function refreshSearchText(tx: Tx | typeof prisma, productId: string) {
  const p = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: { name: true, description: true, category: { select: { name: true } } },
  });
  await tx.product.update({
    where: { id: productId },
    data: { searchText: normalizeSearch([p.name, p.description ?? "", p.category?.name ?? ""].join(" ")) },
  });
}

const slugTaken = (tx: Tx, exceptId?: string) => async (slug: string) =>
  !!(await tx.product.findFirst({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }));

/**
 * Crea un producto junto con su inventario por variante (y, si aplica, sus
 * metadatos de drop) en una única transacción: o se guarda todo, o no se
 * guarda nada. Esto evita el estado inconsistente de "producto sin variantes"
 * que rompería el checkout.
 */
export async function createProductWithInventory(input: CreateProductInput) {
  return prisma.$transaction(async (tx) => {
    if (input.slug && (await slugTaken(tx)(input.slug))) {
      throw AppError.conflict(`El slug "${input.slug}" ya lo usa otro producto`);
    }
    const slug = input.slug ?? (await uniqueSlug(input.name, slugTaken(tx)));

    const product = await tx.product.create({
      data: {
        name: input.name,
        slug,
        description: input.description,
        price: input.price,
        taxRate: input.taxRate,
        weightGrams: input.weightGrams,
        images: input.images,
        productType: input.productType,
        status: input.status,
        categoryId: input.categoryId ?? null,
        seoTitle: input.seoTitle || null,
        seoDescription: input.seoDescription || null,
        variants: {
          create: input.variants.map((v, idx) => ({
            size: v.size,
            color: v.color,
            sku: v.sku || null,
            sortOrder: idx * 10,
            stockAvailable: v.stockAvailable,
            stockReserved: 0,
          })),
        },
      },
    });

    await refreshSearchText(tx, product.id);

    // Metadatos de "cuenta atrás" solo se crean para drops exclusivos.
    if (input.productType === ProductType.DROP_EXCLUSIVO && input.dropMeta) {
      await tx.dropMetadata.create({
        data: {
          productId: product.id,
          releaseAt: input.dropMeta.releaseAt,
          dropStatus: input.dropMeta.dropStatus,
        },
      });
    }

    return tx.product.findUniqueOrThrow({ where: { id: product.id }, include: productInclude });
  });
}

/**
 * Actualiza el producto. Si llega `variants`, es la lista COMPLETA y ordenada:
 *   - las que existen (misma talla + color) actualizan stock, SKU y orden;
 *   - las nuevas se crean;
 *   - las que ya no vienen se desactivan (no se borran: hay pedidos que las
 *     referencian) y dejan de verse en la tienda.
 * Las variantes que pasan de agotadas a tener stock disparan los avisos de
 * reposición; abrir un drop a mano avisa a su lista de espera.
 */
export async function updateProductWithInventory(productId: string, input: UpdateProductInput) {
  const existing = await prisma.product.findUnique({ where: { id: productId }, include: { dropMeta: true } });
  if (!existing) {
    throw AppError.notFound("Producto");
  }
  if (existing.productType === ProductType.TICKET_EVENTO) {
    throw new AppError("Las entradas se gestionan desde Eventos (precio y aforo del evento)", 422);
  }

  const restocked: string[] = [];

  const product = await prisma.$transaction(async (tx) => {
    if (input.slug && input.slug !== existing.slug && (await slugTaken(tx, productId)(input.slug))) {
      throw AppError.conflict(`El slug "${input.slug}" ya lo usa otro producto`);
    }

    await tx.product.update({
      where: { id: productId },
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        price: input.price,
        taxRate: input.taxRate,
        weightGrams: input.weightGrams,
        images: input.images,
        productType: input.productType,
        status: input.status,
        categoryId: input.categoryId,
        seoTitle: input.seoTitle === undefined ? undefined : input.seoTitle || null,
        seoDescription: input.seoDescription === undefined ? undefined : input.seoDescription || null,
      },
    });

    await refreshSearchText(tx, productId);

    if (input.variants) {
      if (input.variants.length === 0) {
        throw new AppError("El producto debe tener al menos una variante", 422);
      }
      const current = await tx.productVariant.findMany({ where: { productId } });
      const key = (v: { size: string; color: string }) => `${v.size.toLowerCase()}|${v.color.toLowerCase()}`;
      const byKey = new Map(current.map((v) => [key(v), v]));
      const keep = new Set<string>();

      for (const [idx, v] of input.variants.entries()) {
        const found = byKey.get(key(v));
        if (found) {
          keep.add(found.id);
          const wasAvailable = found.active ? found.stockAvailable - found.stockReserved : 0;
          await tx.productVariant.update({
            where: { id: found.id },
            data: {
              size: v.size,
              color: v.color,
              sku: v.sku || null,
              sortOrder: idx * 10,
              active: true,
              stockAvailable: v.stockAvailable,
              // Reposición por encima del umbral: rearma la alerta de stock bajo.
              ...(v.stockAvailable - found.stockReserved > env.LOW_STOCK_THRESHOLD ? { lowStockAlertedAt: null } : {}),
            },
          });
          if (wasAvailable <= 0 && v.stockAvailable - found.stockReserved > 0) restocked.push(found.id);
        } else {
          const created = await tx.productVariant.create({
            data: {
              productId,
              size: v.size,
              color: v.color,
              sku: v.sku || null,
              sortOrder: idx * 10,
              stockAvailable: v.stockAvailable,
            },
          });
          keep.add(created.id);
          if (v.stockAvailable > 0) restocked.push(created.id);
        }
      }

      const retired = current.filter((v) => !keep.has(v.id) && v.active).map((v) => v.id);
      if (retired.length) {
        await tx.productVariant.updateMany({ where: { id: { in: retired } }, data: { active: false } });
        // Nadie va a recibir un aviso de una variante que ya no se vende.
        await tx.stockNotification.updateMany({
          where: { productVariantId: { in: retired }, status: StockNotificationStatus.PENDIENTE },
          data: { status: StockNotificationStatus.CANCELADO },
        });
      }
    }

    if (input.dropMeta) {
      await tx.dropMetadata.upsert({
        where: { productId },
        create: {
          productId,
          releaseAt: input.dropMeta.releaseAt,
          dropStatus: input.dropMeta.dropStatus,
        },
        update: {
          releaseAt: input.dropMeta.releaseAt,
          dropStatus: input.dropMeta.dropStatus,
        },
      });
    }

    return tx.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
  });

  // Efectos fuera de la transacción (envían emails).
  await notifyRestock(restocked);
  if (input.dropMeta?.dropStatus === DropStatus.ABIERTO && existing.dropMeta?.dropStatus !== DropStatus.ABIERTO) {
    await notifyOpenedDrops();
  }

  return product;
}

export async function deleteProduct(productId: string) {
  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing) {
    throw AppError.notFound("Producto");
  }
  const sold = await prisma.orderItem.count({ where: { productId } });
  if (sold > 0) {
    // Borrarlo arrastraría (cascade) las líneas de pedidos ya facturados.
    throw AppError.conflict(
      `No se puede eliminar: aparece en ${sold} línea(s) de pedido. Pásalo a BORRADOR o AGOTADO para retirarlo.`
    );
  }
  // onDelete: Cascade en variants/dropMeta se encarga de la limpieza relacional.
  await prisma.product.delete({ where: { id: productId } });
}

export async function listProductsAdmin() {
  const products = await prisma.product.findMany({
    include: {
      ...productInclude,
      _count: {
        select: { stockNotifications: { where: { status: StockNotificationStatus.PENDIENTE } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return { products, lowStockThreshold: env.LOW_STOCK_THRESHOLD };
}
