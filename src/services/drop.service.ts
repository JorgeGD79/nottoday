import { DropStatus, ProductType } from "@prisma/client";
import { AppError } from "@/utils/AppError";

/**
 * Estado "real" de un drop en este instante, calculado al leer (sin worker):
 *   - FINALIZADO manda (cierre permanente).
 *   - ABIERTO manual manda (permite abrir antes de la fecha).
 *   - PROXIMAMENTE se auto-abre en cuanto releaseAt ya pasó.
 */
export function effectiveDropStatus(
  dropMeta: { dropStatus: DropStatus; releaseAt: Date },
  now: Date = new Date()
): DropStatus {
  if (dropMeta.dropStatus === DropStatus.FINALIZADO) return DropStatus.FINALIZADO;
  if (dropMeta.dropStatus === DropStatus.ABIERTO) return DropStatus.ABIERTO;
  return now >= new Date(dropMeta.releaseAt) ? DropStatus.ABIERTO : DropStatus.PROXIMAMENTE;
}

/**
 * Gate de compra: lanza 422 si el producto es un drop que NO está efectivamente
 * ABIERTO. Para productos de tienda general es un no-op. Se usa al añadir al
 * carrito y en el checkout, para que el bloqueo no dependa solo del frontend.
 */
export function assertDropPurchasable(product: {
  productType: ProductType;
  dropMeta: { dropStatus: DropStatus; releaseAt: Date } | null;
}) {
  if (product.productType !== ProductType.DROP_EXCLUSIVO) return;
  if (!product.dropMeta || effectiveDropStatus(product.dropMeta) !== DropStatus.ABIERTO) {
    throw new AppError("Este drop todavía no está disponible", 422);
  }
}
