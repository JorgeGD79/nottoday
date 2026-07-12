import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const listQuerySchema = z.object({
  userId: z.string().cuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

// GET /api/admin/logs — auditoría de acciones de Admin/Staff, paginada y filtrable por usuario.
export async function listAuditLogsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { userId, page, pageSize } = listQuerySchema.parse(request.query);

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: userId ? { userId } : undefined,
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where: userId ? { userId } : undefined }),
  ]);

  return reply.send({
    logs,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}
