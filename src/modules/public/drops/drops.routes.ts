import { FastifyInstance } from "fastify";
import { listDropsHandler } from "./drops.controller";

export async function dropsRoutes(fastify: FastifyInstance) {
  fastify.get("/", listDropsHandler);
}
