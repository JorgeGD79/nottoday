import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import { uploadImagesHandler } from "./uploads.controller";

export async function adminUploadsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.post("/", uploadImagesHandler);
}
