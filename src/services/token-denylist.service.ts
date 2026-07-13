import { redis } from "@/lib/redis";

const KEY_PREFIX = "jwt:revoked:";

/**
 * Denylist de tokens JWT en Redis. Cada token lleva un `jti` único; al hacer
 * logout se guarda ese jti con TTL = tiempo que le queda al token, de modo que
 * Redis lo olvida solo cuando el token ya habría caducado igualmente.
 */
export async function revokeToken(jti?: string, exp?: number): Promise<void> {
  if (!jti) return;
  // Segundos hasta la expiración del token (mínimo 1s por si ya casi expira).
  const ttl = exp ? Math.max(exp - Math.floor(Date.now() / 1000), 1) : 60 * 60 * 8;
  await redis.set(`${KEY_PREFIX}${jti}`, "1", "EX", ttl);
}

export async function isTokenRevoked(jti?: string): Promise<boolean> {
  if (!jti) return false;
  return (await redis.exists(`${KEY_PREFIX}${jti}`)) === 1;
}
