import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { ProductType } from "@prisma/client";
import { CreateProductInput, UpdateProductInput } from "./products.schema";

/**
 * Crea un producto junto con su inventario por talla (y, si aplica, sus
 * metadatos de drop) en una única transacción: o se guarda todo, o no se
 * guarda nada. Esto evita el estado inconsistente de "producto sin tallas"
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
          create: input.variants.map((v) => ({
            size: v.size,
            stockAvailable: v.stockAvailable,
            stockReserved: 0,
          })),
        },
      },
      include: { variants: true },
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

    return tx.product.findUniqueOrThrow({
      where: { id: product.id },
      include: { variants: true, dropMeta: true },
    });
  });
}

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

    // Upsert de variantes: permite ajustar stock de tallas existentes o añadir nuevas
    // sin borrar el historial de stockReserved de las que no cambian.
    if (input.variants) {
      for (const variant of input.variants) {
        await tx.productVariant.upsert({
          where: { productId_size: { productId, size: variant.size } },
          create: { productId, size: variant.size, stockAvailable: variant.stockAvailable },
          update: { stockAvailable: variant.stockAvailable },
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

    return tx.product.findUniqueOrThrow({
      where: { id: productId },
      include: { variants: true, dropMeta: true },
    });
  });
}

export async function deleteProduct(productId: string) {
  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing) {
    throw AppError.notFound("Producto");
  }
  // onDelete: Cascade en variants/dropMeta se encarga de la limpieza relacional.
  await prisma.product.delete({ where: { id: productId } });
}

export async function listProductsAdmin() {
  return prisma.product.findMany({
    include: { variants: true, dropMeta: true },
    orderBy: { createdAt: "desc" },
  });
}
