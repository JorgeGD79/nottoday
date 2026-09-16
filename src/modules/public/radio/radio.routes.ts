import { FastifyInstance } from "fastify";
import { getNowPlayingHandler, getScheduleHandler } from "./radio.controller";

export async function publicRadioRoutes(fastify: FastifyInstance) {
  fastify.get("/now", getNowPlayingHandler);
  fastify.get("/schedule", getScheduleHandler);
}
