// Error de dominio con código HTTP asociado, para que el error handler global
// de Fastify (ver app.ts) sepa qué status devolver sin adivinar.
export class AppError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }

  static notFound(entity: string) {
    return new AppError(`${entity} no encontrado`, 404);
  }

  static conflict(message: string) {
    return new AppError(message, 409);
  }

  static forbidden(message = "No tienes permisos para realizar esta acción") {
    return new AppError(message, 403);
  }

  static unauthorized(message = "No autenticado") {
    return new AppError(message, 401);
  }
}
