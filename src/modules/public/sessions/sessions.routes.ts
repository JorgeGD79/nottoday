import { FastifyInstance } from "fastify";
import { listPublicSessionsHandler } from "./sessions.controller";

export async function publicSessionsRoutes(fastify: FastifyInstance) {
  fastify.get("/", listPublicSessionsHandler);
}
