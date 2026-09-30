import { FastifyInstance } from "fastify";
import { authenticate } from "@/middleware/authenticate";
import { isAdmin } from "@/middleware/authorize";
import { exportSubscribersHandler, listSubscribersHandler } from "./newsletter.controller";
import {
  createCampaignHandler,
  deleteCampaignHandler,
  duplicateCampaignHandler,
  listCampaignsHandler,
  previewCampaignHandler,
  resumeCampaignHandler,
  sendCampaignHandler,
  testCampaignHandler,
  updateCampaignHandler,
} from "./campaigns.controller";

export async function adminNewsletterRoutes(fastify: FastifyInstance) {
  // Datos personales de terceros: solo ADMIN.
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", isAdmin);

  fastify.get("/", listSubscribersHandler);
  fastify.get("/export", exportSubscribersHandler);

  // Campañas: redactar, previsualizar, probar y enviar.
  fastify.get("/campaigns", listCampaignsHandler);
  fastify.post("/campaigns", createCampaignHandler);
  fastify.post("/campaigns/preview", previewCampaignHandler);
  fastify.put("/campaigns/:id", updateCampaignHandler);
  fastify.delete("/campaigns/:id", deleteCampaignHandler);
  fastify.post("/campaigns/:id/duplicate", duplicateCampaignHandler);
  fastify.post("/campaigns/:id/test", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, testCampaignHandler);
  fastify.post("/campaigns/:id/send", sendCampaignHandler);
  fastify.post("/campaigns/:id/resume", resumeCampaignHandler);
}
