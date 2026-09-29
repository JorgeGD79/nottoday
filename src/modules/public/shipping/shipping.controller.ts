import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";

/**
 * GET /api/shipping
 *
 * Métodos de envío disponibles en el checkout. Los define el admin desde su
 * panel (nombre + coste); aquí solo se exponen los activos, ordenados.
 */
export async function listShippingMethodsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const cached = await getCached(CACHE_KEYS.shipping);
  if (cached) {
    return reply.header("X-Cache", "HIT").send(cached);
  }

  const methods = await prisma.shippingMethod.findMany({
    where: { active: true },
    select: { id: true, name: true, description: true, price: true },
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });

  const payload = { methods };
  await setCached(CACHE_KEYS.shipping, payload, CACHE_TTL_SECONDS.shipping);

  return reply.header("X-Cache", "MISS").send(payload);
}

/**
 * GET /api/shipping/countries
 *
 * Países a los que se puede enviar, para el selector del checkout:
 * `anyCountry` = hay una zona "resto del mundo" o métodos sin zona (valen
 * para cualquier país); si no, solo los países de las zonas con métodos activos.
 */
export async function listShippingCountriesHandler(_request: FastifyRequest, reply: FastifyReply) {
  const cacheKey = `${CACHE_KEYS.shipping}:countries`;
  const cached = await getCached(cacheKey);
  if (cached) return reply.header("X-Cache", "HIT").send(cached);

  const [zones, zonelessMethods] = await Promise.all([
    prisma.shippingZone.findMany({
      where: { methods: { some: { active: true } } },
      select: { countries: true, restOfWorld: true },
    }),
    prisma.shippingMethod.count({ where: { active: true, zoneId: null } }),
  ]);

  const payload = {
    anyCountry: zonelessMethods > 0 || zones.some((z) => z.restOfWorld),
    countries: [...new Set(zones.flatMap((z) => z.countries))].sort(),
  };
  await setCached(cacheKey, payload, CACHE_TTL_SECONDS.shipping);
  return reply.header("X-Cache", "MISS").send(payload);
}
