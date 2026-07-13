import "fastify";
import "@fastify/jwt";
import { Role } from "@prisma/client";

// Payload que firmamos dentro del JWT (ver auth.controller.ts)
export interface JwtUserPayload {
  id: string;
  role: Role;
  email: string;
  jti?: string; // id único del token, para poder revocarlo (denylist en Redis)
  exp?: number; // expiración (epoch segundos), la añade @fastify/jwt al firmar
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtUserPayload;
    user: JwtUserPayload;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    // Poblado por el hook `authenticate` tras verificar el JWT.
    user: JwtUserPayload;
    // Buffer crudo del body, necesario para verificar la firma de los webhooks de Stripe.
    rawBody: Buffer;
  }
}
