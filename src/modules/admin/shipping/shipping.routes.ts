import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isStaffOrAdmin } from "@/middleware/authorize";
import {
  createShippingMethodHandler,
  createShippingZoneHandler,
  deleteShippingZoneHandler,
  updateShippingZoneHandler,
  deleteShippingMethodHandler,
  listShippingMethodsAdminHandler,
  updateShippingMethodHandler,
} from "./shipping.controller";

export async function adminShippingRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isStaffOrAdmin);

  fastify.get("/", listShippingMethodsAdminHandler);
  fastify.post("/zones", createShippingZoneHandler);
  fastify.put("/zones/:id", updateShippingZoneHandler);
  fastify.delete("/zones/:id", deleteShippingZoneHandler);
  fastify.post("/", createShippingMethodHandler);
  fastify.put("/:id", updateShippingMethodHandler);
  fastify.delete("/:id", deleteShippingMethodHandler);
}
