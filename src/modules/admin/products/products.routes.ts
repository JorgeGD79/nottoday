import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import {
  createProductHandler,
  deleteProductHandler,
  listProductsHandler,
  updateProductHandler,
} from "./products.controller";

export async function adminProductsRoutes(fastify: FastifyInstance) {
  // Todas las rutas de este plugin exigen JWT válido + rol ADMIN o STAFF.
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.get("/", listProductsHandler);
  fastify.post("/", createProductHandler);
  fastify.put("/:id", updateProductHandler);
  fastify.delete("/:id", deleteProductHandler);
}
