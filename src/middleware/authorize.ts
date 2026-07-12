import { FastifyReply, FastifyRequest } from "fastify";
import { Role } from "@prisma/client";
import { AppError } from "@/utils/AppError";

/**
 * Fábrica de guards de rol. Genera un preHandler que comprueba que
 * `request.user.role` (poblado por `authenticate`) esté en la whitelist.
 *
 * IMPORTANTE: debe registrarse SIEMPRE después de `authenticate` en el array
 * de preHandlers de la ruta, ya que depende de request.user existir:
 *
 *   fastify.post('/api/admin/products', { preHandler: [authenticate, isAdmin] }, handler)
 */
function requireRole(allowedRoles: Role[]) {
  return async function roleGuard(request: FastifyRequest, _reply: FastifyReply) {
    if (!request.user) {
      // Defensa en profundidad: si alguien registra este guard sin `authenticate` antes.
      throw AppError.unauthorized();
    }
    if (!allowedRoles.includes(request.user.role)) {
      throw AppError.forbidden(
        `Rol '${request.user.role}' no autorizado. Se requiere: ${allowedRoles.join(", ")}`
      );
    }
  };
}

// Solo ADMIN: gestión de descuentos, borrado de artistas/eventos, ver logs de auditoría.
export const isAdmin = requireRole([Role.ADMIN]);

// ADMIN o STAFF: operativa diaria del panel (crear/editar productos, eventos, revisar bookings).
export const isStaffOrAdmin = requireRole([Role.ADMIN, Role.STAFF]);

// Cualquier usuario autenticado con perfil de artista (para futura zona privada del artista).
export const isArtist = requireRole([Role.ARTISTA, Role.ADMIN]);
