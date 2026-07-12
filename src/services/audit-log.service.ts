import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { FastifyRequest } from "fastify";

interface RecordAuditLogParams {
  userId: string;
  action: string;
  request: FastifyRequest;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Registra una acción de Admin/Staff en la tabla AuditLog.
 * Se llama de forma "fire and forget" controlada (await, pero sin bloquear
 * la respuesta al cliente si falla: ver catch abajo) desde cada controlador
 * de escritura del panel de administración.
 */
export async function recordAuditLog({ userId, action, request, metadata }: RecordAuditLogParams) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        ip: request.ip,
        metadata: metadata ?? undefined,
      },
    });
  } catch (err) {
    // Un fallo al auditar NUNCA debe tumbar la operación de negocio que la originó.
    request.log.error({ err }, "No se pudo registrar el audit log");
  }
}
