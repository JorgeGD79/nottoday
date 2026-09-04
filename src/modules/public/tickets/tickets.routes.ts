import { FastifyInstance } from "fastify";
import { listTicketsHandler } from "./tickets.controller";

export async function ticketsRoutes(fastify: FastifyInstance) {
  fastify.get("/", listTicketsHandler);
}
