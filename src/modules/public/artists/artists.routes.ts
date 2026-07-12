import { FastifyInstance } from "fastify";
import { listPublicArtistsHandler } from "./artists.controller";

export async function publicArtistsRoutes(fastify: FastifyInstance) {
  fastify.get("/", listPublicArtistsHandler);
}
