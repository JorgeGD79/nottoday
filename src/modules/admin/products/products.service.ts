import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { Prisma, ProductType } from "@prisma/client";
import { CreateProductInput, UpdateProductInput } from "./products.schema";

const productInclude = {
  variants: { orderBy: [{ active: "desc" }, { sortOrder: "asc" }] },
  dropMeta: true,
} satisfies Prisma.ProductInclude;

/**
 * Crea un producto junto con su inventario por variante (y, si aplica, sus
 * metadatos de drop) en una única transacción: o se guarda todo, o no se
 * guarda nada. Esto evita el estado inconsistente de "producto sin variantes"
 * que rompería el checkout.
 */
export async function createProductWithInventory(input: CreateProductInput) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        name: input.name,
        description: input.description,
        price: input.price,
        images: input.images,
        productType: input.productType,
        status: input.status,
        eventId: input.eventId,
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
 */
export async function updateProductWithInventory(productId: string, input: UpdateProductInput) {
  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing) {
    throw AppError.notFound("Producto");
  }

  return prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: productId },
      data: {
        name: input.name,
        description: input.description,
        price: input.price,
        images: input.images,
        productType: input.productType,
        status: input.status,
        eventId: input.eventId,
      },
    });

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
          await tx.productVariant.update({
            where: { id: found.id },
            data: {
              size: v.size,
              color: v.color,
              sku: v.sku || null,
              sortOrder: idx * 10,
              active: true,
              stockAvailable: v.stockAvailable,
            },
          });
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
        }
      }

      const retired = current.filter((v) => !keep.has(v.id) && v.active).map((v) => v.id);
      if (retired.length) {
        await tx.productVariant.updateMany({ where: { id: { in: retired } }, data: { active: false } });
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
  return prisma.product.findMany({
    include: productInclude,
    orderBy: { createdAt: "desc" },
  });
}
