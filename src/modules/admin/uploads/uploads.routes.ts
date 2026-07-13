import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import { uploadImagesHandler } from "./uploads.controller";

export async function adminUploadsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  // Rate-limit propio (además del auth): evita abuso/coste en Cloudinary aunque
  // la cuenta sea de staff.
  fastify.post("/", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, uploadImagesHandler);
}
