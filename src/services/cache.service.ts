import { redis } from "@/lib/redis";

// Claves y TTL centralizados para el cache de catálogo público.
// GET /api/drops es el endpoint de mayor tráfico en la ventana de lanzamiento
// de un drop, así que se sirve desde Redis y solo golpea Postgres en caso de miss.
export const CACHE_KEYS = {
  drops: "cache:drops:list",
  shop: (page: number, pageSize: number) => `cache:shop:list:${page}:${pageSize}`,
  tickets: "cache:tickets:list",
  events: "cache:events:list",
  artists: "cache:artists:list",
  sessions: "cache:sessions:list",
  shipping: "cache:shipping:list",
};

export const CACHE_TTL_SECONDS = {
  drops: 30, // ventana corta: el estado de un drop (Próximamente -> Abierto) cambia en caliente
  shop: 120,
  tickets: 60,
  events: 120,
  artists: 120,
  sessions: 120,
  shipping: 120,
};

export async function getCached<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function setCached(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

/**
 * Invalida el cache de catálogo. Se invoca desde los controladores de admin
 * (products.controller) tras cualquier escritura que pueda afectar a lo que
 * ve la web pública: crear/editar/borrar producto o stock, cambiar dropStatus, etc.
 */
export async function invalidateCatalogCache(): Promise<void> {
  const keys = await redis.keys("cache:shop:list:*");
  await Promise.all([
    redis.del(CACHE_KEYS.drops),
    redis.del(CACHE_KEYS.tickets),
    ...(keys.length ? [redis.del(...keys)] : []),
  ]);
}

/**
 * Invalida la agenda pública de eventos. Se invoca desde el panel de admin
 * tras crear/editar/borrar un evento, para que el frontend refleje el cambio
 * sin esperar a que expire el TTL.
 */
export async function invalidateEventsCache(): Promise<void> {
  await redis.del(CACHE_KEYS.events);
}

/**
 * Invalida el roster público y las N-TY Sessions. Un cambio en un artista
 * afecta a ambas listas (las sesiones embeben datos del artista), así que
 * se invalidan juntas desde los paneles de admin de artistas y sesiones.
 */
export async function invalidateArtistsCache(): Promise<void> {
  await redis.del(CACHE_KEYS.artists, CACHE_KEYS.sessions);
}

/** Invalida la lista pública de métodos de envío (se llama desde el admin). */
export async function invalidateShippingCache(): Promise<void> {
  await redis.del(CACHE_KEYS.shipping);
}
