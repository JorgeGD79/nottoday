import { FastifyReply, FastifyRequest } from "fastify";
import { loginSchema } from "./auth.schema";
import { validateCredentials } from "./auth.service";

export async function loginHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = loginSchema.parse(request.body);
  const user = await validateCredentials(input.email, input.password);

  const token = await reply.jwtSign(
    { id: user.id, role: user.role, email: user.email },
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
