import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import {
  createCategoryHandler,
  deleteCategoryHandler,
  listCategoriesHandler,
  updateCategoryHandler,
} from "./categories.controller";

export async function adminCategoriesRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.get("/", listCategoriesHandler);
  fastify.post("/", createCategoryHandler);
  fastify.put("/:id", updateCategoryHandler);
  fastify.delete("/:id", deleteCategoryHandler);
}
