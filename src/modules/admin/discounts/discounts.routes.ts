import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isAdmin } from "@/middleware/authorize";
import {
  createDiscountHandler,
  deleteDiscountHandler,
  listDiscountsHandler,
  updateDiscountHandler,
} from "./discounts.controller";

export async function adminDiscountsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  // Los cupones tienen impacto financiero directo (campañas de Instagram, etc.)
  // por lo que, a diferencia de products/artists/events, se restringen a rol ADMIN.
  fastify.addHook("preHandler", isAdmin);

  fastify.get("/", listDiscountsHandler);
  fastify.post("/", createDiscountHandler);
  fastify.put("/:id", updateDiscountHandler);
  fastify.delete("/:id", deleteDiscountHandler);
}
