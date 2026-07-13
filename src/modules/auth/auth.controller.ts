import { randomUUID } from "node:crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import { loginSchema } from "./auth.schema";
import { validateCredentials } from "./auth.service";
import { revokeToken } from "@/services/token-denylist.service";

export async function loginHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = loginSchema.parse(request.body);
  const user = await validateCredentials(input.email, input.password);

  // jti (id único del token) para poder revocarlo en el logout (denylist en Redis).
  const token = await reply.jwtSign(
    { id: user.id, role: user.role, email: user.email, jti: randomUUID() },
    { expiresIn: process.env.JWT_EXPIRES_IN ?? "8h" }
  );

  return reply.send({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    token,
  });
}

export async function meHandler(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ user: request.user });
}

/**
 * POST /api/auth/logout — invalida el token actual añadiéndolo a la denylist de
 * Redis hasta su expiración. A partir de aquí, `authenticate` lo rechaza aunque
 * no haya caducado (revocación real, no solo borrar localStorage en el cliente).
 */
export async function logoutHandler(request: FastifyRequest, reply: FastifyReply) {
  await revokeToken(request.user.jti, request.user.exp);
  return reply.code(204).send();
}
