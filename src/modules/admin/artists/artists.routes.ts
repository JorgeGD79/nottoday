import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import {
  createArtistHandler,
  deleteArtistHandler,
  listArtistsHandler,
  updateArtistHandler,
} from "./artists.controller";

export async function adminArtistsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.get("/", listArtistsHandler);
  fastify.post("/", createArtistHandler);
  fastify.put("/:id", updateArtistHandler);
  fastify.delete("/:id", deleteArtistHandler);
}
