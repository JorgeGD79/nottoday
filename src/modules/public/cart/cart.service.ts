import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { CartStatus } from "@prisma/client";
import { validateAndPriceDiscount } from "@/services/discount.service";
import { assertDropPurchasable } from "@/services/drop.service";

const cartInclude = {
  items: { include: { product: true, productVariant: true } },
  discountCode: true,
} as const;

export function computeSubtotal(cart: { items: { quantity: number; product: { price: unknown } }[] }) {
  return cart.items.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
}

export async function getOrCreateCart(cartId?: string, email?: string) {
  if (cartId) {
    const cart = await prisma.cart.findUnique({ where: { id: cartId }, include: cartInclude });
    if (!cart) throw AppError.notFound("Carrito");
    return cart;
  }
  return prisma.cart.create({ data: { email, status: CartStatus.ACTIVO }, include: cartInclude });
}

export async function addItemToCart(input: {
  cartId?: string;
  email?: string;
  productId: string;
  productVariantId: string;
  quantity: number;
}) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: input.productVariantId },
    include: { product: { include: { dropMeta: true } } },
  });
  if (!variant || variant.productId !== input.productId) {
    throw AppError.notFound("Variante de producto");
  }

  // No se puede añadir un drop que aún no está abierto (gate de servidor).
  assertDropPurchasable(variant.product);

  // Comprobación "optimista" de stock a nivel de carrito. La verdad definitiva
  // (con row locking) se aplica en el checkout, aquí solo evitamos UX confusa.
  const availableToPromise = variant.stockAvailable - variant.stockReserved;
  if (availableToPromise < input.quantity) {
    throw new AppError(`Stock insuficiente para la talla ${variant.size}`, 422);
  }

  const cart = await getOrCreateCart(input.cartId, input.email);

  await prisma.cartItem.upsert({
    where: { cartId_productVariantId: { cartId: cart.id, productVariantId: input.productVariantId } },
    create: {
      cartId: cart.id,
      productId: input.productId,
      productVariantId: input.productVariantId,
      quantity: input.quantity,
    },
    update: { quantity: { increment: input.quantity } },
  });

  await prisma.cart.update({
    where: { id: cart.id },
    data: { status: CartStatus.ACTIVO, updatedAt: new Date(), abandonedNotifiedAt: null },
  });

  return prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: cartInclude });
}

export async function applyDiscountToCart(cartId: string, code: string) {
  const cart = await prisma.cart.findUnique({ where: { id: cartId }, include: cartInclude });
  if (!cart) throw AppError.notFound("Carrito");

  const subtotal = computeSubtotal(cart);
  // Reutilizamos el mismo motor que el checkout: si el cupón no es válido aquí,
  // tampoco lo será unos minutos después al pagar.
  const evaluation = await validateAndPriceDiscount(code, subtotal);

  await prisma.cart.update({ where: { id: cartId }, data: { discountCodeId: evaluation.discountId } });

  return { cart: await prisma.cart.findUniqueOrThrow({ where: { id: cartId }, include: cartInclude }), evaluation };
}

export async function setItemQuantity(cartId: string, productVariantId: string, quantity: number) {
  const cart = await prisma.cart.findUnique({ where: { id: cartId } });
  if (!cart) throw AppError.notFound("Carrito");

  // Cantidad 0 (o menos) = quitar la línea.
  if (quantity <= 0) {
    return removeItemFromCart(cartId, productVariantId);
  }

  const variant = await prisma.productVariant.findUnique({ where: { id: productVariantId } });
  if (!variant) throw AppError.notFound("Variante de producto");

  const availableToPromise = variant.stockAvailable - variant.stockReserved;
  if (availableToPromise < quantity) {
    throw new AppError(`Stock insuficiente para la talla ${variant.size} (disponible: ${availableToPromise})`, 422);
  }

  // updateMany para no lanzar si la línea no existe (no-op idempotente).
  await prisma.cartItem.updateMany({ where: { cartId, productVariantId }, data: { quantity } });
  await prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });

  return prisma.cart.findUniqueOrThrow({ where: { id: cartId }, include: cartInclude });
}

export async function removeItemFromCart(cartId: string, productVariantId: string) {
  const cart = await prisma.cart.findUnique({ where: { id: cartId } });
  if (!cart) throw AppError.notFound("Carrito");

  // deleteMany (en vez de delete) para no lanzar si la línea ya no existe:
  // eliminar algo que no está es un no-op idempotente, no un error.
  await prisma.cartItem.deleteMany({ where: { cartId, productVariantId } });

  await prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });

  return prisma.cart.findUniqueOrThrow({ where: { id: cartId }, include: cartInclude });
}

export async function getCart(cartId: string) {
  const cart = await prisma.cart.findUnique({ where: { id: cartId }, include: cartInclude });
  if (!cart) throw AppError.notFound("Carrito");
  return cart;
}
