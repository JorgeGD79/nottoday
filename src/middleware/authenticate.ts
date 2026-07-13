import { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "@/utils/AppError";
import { isTokenRevoked } from "@/services/token-denylist.service";

/**
 * Hook de autenticación: verifica el JWT firmado (@fastify/jwt) y, si es válido,
 * deja el payload decodificado en `request.user` para que el resto de handlers
 * y los guards de rol (ver authorize.ts) puedan confiar en él.
 *
 * Se usa como `preHandler` en las rutas protegidas, nunca de forma global,
 * para que la API pública (shop, drops, checkout) siga siendo accesible sin token.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
  try {
    // request.jwtVerify() lee el header "Authorization: Bearer <token>",
    // valida firma + expiración y popula request.user vía FastifyJWT.
    await request.jwtVerify();
  } catch {
    throw AppError.unauthorized("Token inválido o expirado");
  }

  // Revocación: un token cuyo jti esté en la denylist (logout) se rechaza aunque
  // la firma sea válida y no haya caducado.
  if (await isTokenRevoked(request.user.jti)) {
    throw AppError.unauthorized("Sesión cerrada");
  }
}
