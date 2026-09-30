import { FastifyInstance } from "fastify";
import {
  issueDetailHandler,
  listIssuesHandler,
  oneClickUnsubscribeHandler,
  subscribeHandler,
  unsubscribeHandler,
} from "./newsletter.controller";

export async function publicNewsletterRoutes(fastify: FastifyInstance) {
  // Límite estricto: cada alta puede disparar un email, no queremos que sirva para spamear.
  // Archivo público de números publicados.
  fastify.get("/issues", listIssuesHandler);
  fastify.get("/issues/:id", issueDetailHandler);

  fastify.post("/subscribe", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, subscribeHandler);
  fastify.post("/unsubscribe", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, unsubscribeHandler);

  // Baja en un clic (RFC 8058): Gmail/Yahoo hacen un POST form-urlencoded con
  // "List-Unsubscribe=One-Click" a la URL de la cabecera. El cuerpo no importa
  // (el token va en la URL), así que se acepta como texto sin parsear.
  fastify.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => done(null, body));
  fastify.post("/one-click/:token", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, oneClickUnsubscribeHandler);
}
