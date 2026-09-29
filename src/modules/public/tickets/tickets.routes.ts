import { FastifyInstance } from "fastify";
import { listTicketsHandler, ticketQrHandler } from "./tickets.controller";

export async function ticketsRoutes(fastify: FastifyInstance) {
  fastify.get("/", listTicketsHandler);
  fastify.get("/qr/:code", ticketQrHandler);
}
