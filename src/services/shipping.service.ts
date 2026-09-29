import { Prisma, ShippingMethod, ShippingZone } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export const COUNTRY_CODE_REGEX = /^[A-Z]{2}$/;

/**
 * Zona de envío de un país: la que lo incluye explícitamente o, si ninguna,
 * la marcada como "resto del mundo". null = no hay zona (solo valen los
 * métodos sin zona, que sirven para cualquier país).
 */
export async function resolveZone(db: Db, country: string): Promise<ShippingZone | null> {
  const code = country.toUpperCase();
  const zones = await db.shippingZone.findMany({ orderBy: { sortOrder: "asc" } });
  return zones.find((z) => z.countries.includes(code)) ?? zones.find((z) => z.restOfWorld) ?? null;
}

/**
 * Coste de un método para un peso y un importe de productos:
 *   precio base (incluye el primer kilo)
 *   + suplemento por cada kilo o fracción por encima del primero,
 *   o 0 si el importe supera el umbral de envío gratis del método.
 */
export function shippingCost(
  method: Pick<ShippingMethod, "price" | "pricePerExtraKg" | "freeOverAmount">,
  weightGrams: number,
  productsAmount: number
): number {
  if (method.freeOverAmount !== null && productsAmount >= Number(method.freeOverAmount)) return 0;
  const extraKg = Math.max(0, Math.ceil((weightGrams - 1000) / 1000));
  return round2(Number(method.price) + extraKg * Number(method.pricePerExtraKg));
}

export interface ShippingOption {
  id: string;
  name: string;
  description: string | null;
  cost: number;
}

/**
 * Métodos disponibles para un país y un peso: los de su zona más los que no
 * tienen zona, activos y cuyo peso máximo admite el paquete.
 */
export async function shippingOptionsFor(
  db: Db,
  zone: ShippingZone | null,
  weightGrams: number,
  productsAmount: number
): Promise<(ShippingOption & { method: ShippingMethod })[]> {
  const methods = await db.shippingMethod.findMany({
    where: {
      active: true,
      OR: [{ zoneId: null }, ...(zone ? [{ zoneId: zone.id }] : [])],
    },
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });

  return methods
    .filter((m) => m.maxWeightGrams === null || weightGrams <= m.maxWeightGrams)
    .map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      cost: shippingCost(m, weightGrams, productsAmount),
      method: m,
    }));
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
