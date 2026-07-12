import { FastifyInstance } from "fastify";
import { listPublicEventsHandler } from "./events.controller";

export async function publicEventsRoutes(fastify: FastifyInstance) {
  fastify.get("/", listPublicEventsHandler);
}
