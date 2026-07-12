import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { DiscountStatus, DiscountType } from "@prisma/client";

interface DiscountEvaluation {
  discountId: string;
  code: string;
  type: DiscountType;
  discountAmount: number; // en la misma unidad monetaria que subtotal
  freeShipping: boolean;
}

/**
 * Motor de validación de cupones en tiempo real. Se invoca tanto al aplicar
 * un código al carrito como, de nuevo, dentro de la transacción de checkout
 * (nunca confiamos en un descuento "ya validado" que llega del cliente).
 *
 * Reglas comprobadas: existe, está ACTIVO, dentro de la ventana de fechas,
 * no ha superado maxUses, y el subtotal cumple la compra mínima requerida.
 */
export async function validateAndPriceDiscount(
  code: string,
  subtotal: number,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<DiscountEvaluation> {
  const discount = await tx.discount.findUnique({ where: { code: code.trim().toUpperCase() } });

  if (!discount) {
    throw AppError.notFound("Código de descuento");
  }
  if (discount.status !== DiscountStatus.ACTIVO) {
    throw new AppError("Este código de descuento no está activo", 422);
  }

  const now = new Date();
  if (now < discount.startDate || now > discount.endDate) {
    throw new AppError("Este código de descuento ha expirado o aún no es válido", 422);
  }
  if (discount.maxUses !== null && discount.currentUses >= discount.maxUses) {
    throw new AppError("Este código de descuento ha alcanzado su límite de usos", 422);
  }
  if (subtotal < Number(discount.minPurchaseAmount)) {
    throw new AppError(
      `La compra mínima para este código es ${discount.minPurchaseAmount}`,
      422
    );
  }

  let discountAmount = 0;
  let freeShipping = false;

  switch (discount.type) {
    case DiscountType.PORCENTAJE:
      discountAmount = Math.round(subtotal * (Number(discount.value) / 100) * 100) / 100;
      break;
    case DiscountType.MONTO_FIJO:
      discountAmount = Math.min(Number(discount.value), subtotal);
      break;
    case DiscountType.ENVIO_GRATIS:
      freeShipping = true;
      break;
  }

  return { discountId: discount.id, code: discount.code, type: discount.type, discountAmount, freeShipping };
}

/** Incrementa el contador de usos de forma atómica; se llama solo tras confirmar el pago. */
export async function incrementDiscountUsage(discountId: string, tx: Prisma.TransactionClient) {
  await tx.discount.update({
    where: { id: discountId },
    data: { currentUses: { increment: 1 } },
  });
}
