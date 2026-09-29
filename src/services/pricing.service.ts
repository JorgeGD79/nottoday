import { Prisma, ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";
import { variantLabel } from "@/utils/slug";
import { validateAndPriceDiscount } from "@/services/discount.service";
import { COUNTRY_CODE_REGEX, ShippingOption, resolveZone, round2, shippingOptionsFor } from "@/services/shipping.service";

type Db = Prisma.TransactionClient | typeof prisma;

// ============================================================================
// Motor de precios: la ÚNICA fuente de verdad del importe de un carrito. Lo
// usan el resumen del checkout (POST /api/cart/:id/quote), el propio checkout
// (dentro de su transacción) y, a través del snapshot que guarda el pedido,
// la factura. Así lo que ve el cliente, lo que se cobra y lo que se factura
// siempre coinciden.
//
// Reglas fiscales (B2C, España):
//   - Los precios del catálogo llevan el IVA INCLUIDO, con el tipo del producto.
//   - Zona de envío marcada como exenta (exportación fuera de la UE): los
//     productos físicos se venden sin IVA (precio / (1 + tipo)).
//   - Las entradas siempre llevan IVA: el evento se consume en España.
//   - El envío lleva el IVA de SHIPPING_TAX_RATE (0 en exportación).
//   - El cupón se aplica sobre el subtotal y se prorratea entre las líneas
//     para calcular la base imponible de cada tipo.
// ============================================================================

export interface PricingCartItem {
  productId: string;
  productVariantId: string;
  quantity: number;
  product: { name: string; price: unknown; taxRate: unknown; weightGrams: number; productType: ProductType };
  productVariant: { size: string; color: string };
}

export interface QuoteLine {
  productId: string;
  productVariantId: string;
  name: string;
  variantLabel: string;
  productType: ProductType;
  quantity: number;
  unitPrice: number; // lo que se cobra por unidad
  taxRate: number; // tipo efectivo (0 si exento)
  lineTotal: number; // unitPrice * quantity
  discountAmount: number; // parte del cupón que le toca a la línea
  taxAmount: number; // IVA incluido en (lineTotal - discountAmount)
}

export interface Quote {
  lines: QuoteLine[];
  requiresShipping: boolean;
  weightGrams: number;
  country: string | null;
  taxExempt: boolean;
  subtotal: number;
  discount: { code: string; amount: number; freeShipping: boolean } | null;
  discountError: string | null;
  discountId: string | null;
  shippingOptions: ShippingOption[];
  shippingMethod: ShippingOption | null;
  shippingCost: number;
  shippingTaxRate: number;
  taxAmount: number;
  taxBreakdown: { rate: number; base: number; tax: number }[];
  total: number;
}

/** IVA contenido en un importe con IVA incluido. */
export const includedTax = (gross: number, rate: number) => (rate > 0 ? round2(gross - gross / (1 + rate / 100)) : 0);

export async function quoteCart(
  db: Db,
  cart: { items: PricingCartItem[]; discountCode: { code: string } | null },
  opts: { country?: string | null; shippingMethodId?: string | null; strict?: boolean }
): Promise<Quote> {
  const country = opts.country ? opts.country.toUpperCase() : null;
  if (country && !COUNTRY_CODE_REGEX.test(country)) throw new AppError("País no válido", 400);

  const requiresShipping = cart.items.some((i) => i.product.productType !== ProductType.TICKET_EVENTO);
  const zone = country ? await resolveZone(db, country) : null;
  const taxExempt = !!zone?.taxExempt;

  // --- Líneas ---
  const lines: QuoteLine[] = cart.items.map((item) => {
    const rate = Number(item.product.taxRate);
    const physical = item.product.productType !== ProductType.TICKET_EVENTO;
    const exemptLine = taxExempt && physical;
    const unitPrice = exemptLine ? round2(Number(item.product.price) / (1 + rate / 100)) : Number(item.product.price);
    return {
      productId: item.productId,
      productVariantId: item.productVariantId,
      name: item.product.name,
      variantLabel: variantLabel(item.productVariant),
      productType: item.product.productType,
      quantity: item.quantity,
      unitPrice,
      taxRate: exemptLine ? 0 : rate,
      lineTotal: round2(unitPrice * item.quantity),
      discountAmount: 0,
      taxAmount: 0,
    };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const weightGrams = cart.items
    .filter((i) => i.product.productType !== ProductType.TICKET_EVENTO)
    .reduce((s, i) => s + i.product.weightGrams * i.quantity, 0);

  // --- Cupón ---
  let discount: Quote["discount"] = null;
  let discountError: string | null = null;
  let discountId: string | null = null;
  if (cart.discountCode) {
    try {
      const ev = await validateAndPriceDiscount(cart.discountCode.code, subtotal, db);
      discount = { code: ev.code, amount: round2(ev.discountAmount), freeShipping: ev.freeShipping };
      discountId = ev.discountId;
    } catch (err) {
      if (opts.strict) throw err;
      discountError = (err as Error).message;
    }
  }
  const discountAmount = discount?.amount ?? 0;

  // Prorrateo del cupón entre líneas (la última absorbe el redondeo).
  if (discountAmount > 0 && subtotal > 0) {
    let assigned = 0;
    lines.forEach((l, idx) => {
      l.discountAmount = idx === lines.length - 1
        ? round2(discountAmount - assigned)
        : round2((discountAmount * l.lineTotal) / subtotal);
      assigned = round2(assigned + l.discountAmount);
    });
  }
  lines.forEach((l) => { l.taxAmount = includedTax(l.lineTotal - l.discountAmount, l.taxRate); });

  const productsAmount = round2(subtotal - discountAmount);

  // --- Envío ---
  let shippingOptions: ShippingOption[] = [];
  let shippingMethod: ShippingOption | null = null;
  if (requiresShipping && country) {
    const options = await shippingOptionsFor(db, zone, weightGrams, productsAmount);
    shippingOptions = options.map(({ method: _m, ...o }) => ({
      ...o,
      cost: discount?.freeShipping ? 0 : o.cost,
    }));
    if (opts.shippingMethodId) {
      shippingMethod = shippingOptions.find((o) => o.id === opts.shippingMethodId) ?? null;
      if (!shippingMethod && opts.strict) {
        throw new AppError("El método de envío elegido no está disponible para ese país o ese peso", 422);
      }
    }
  }
  if (opts.strict && requiresShipping) {
    if (!country) throw new AppError("Indica el país de envío", 422);
    if (!shippingMethod) {
      throw new AppError(
        shippingOptions.length ? "Elige un método de envío" : "No hacemos envíos a ese país con este pedido",
        422
      );
    }
  }
  const shippingCost = shippingMethod?.cost ?? 0;
  const shippingTaxRate = taxExempt ? 0 : env.SHIPPING_TAX_RATE;

  // --- IVA ---
  const breakdown = new Map<number, { gross: number }>();
  for (const l of lines) {
    const b = breakdown.get(l.taxRate) ?? { gross: 0 };
    b.gross += l.lineTotal - l.discountAmount;
    breakdown.set(l.taxRate, b);
  }
  if (shippingCost > 0) {
    const b = breakdown.get(shippingTaxRate) ?? { gross: 0 };
    b.gross += shippingCost;
    breakdown.set(shippingTaxRate, b);
  }
  const taxBreakdown = [...breakdown.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rate, { gross }]) => {
      const tax = includedTax(gross, rate);
      return { rate, base: round2(gross - tax), tax };
    });
  const taxAmount = round2(taxBreakdown.reduce((s, b) => s + b.tax, 0));

  return {
    lines,
    requiresShipping,
    weightGrams,
    country,
    taxExempt,
    subtotal,
    discount,
    discountError,
    discountId,
    shippingOptions,
    shippingMethod,
    shippingCost,
    shippingTaxRate,
    taxAmount,
    taxBreakdown,
    total: round2(productsAmount + shippingCost),
  };
}
