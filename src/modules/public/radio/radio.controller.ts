import { FastifyReply, FastifyRequest } from "fastify";
import { computeNowPlaying, getRadioSchedule } from "@/services/radio-schedule.service";

/**
 * GET /api/radio/now
 *
 * Calcula qué franja y qué pista tocan en este instante exacto (según la
 * parrilla semanal), y el segundo en el que debería empezar el reproductor.
 * Alimenta el bloque "ON AIR" y la sincronización entre oyentes.
 */
export async function getNowPlayingHandler(_request: FastifyRequest, reply: FastifyReply) {
  const shows = await getRadioSchedule();
  const nowPlaying = computeNowPlaying(shows, new Date());
  return reply.send(nowPlaying);
}

/**
 * GET /api/radio/schedule
 *
 * Devuelve la parrilla semanal completa (franjas activas + su playlist),
 * para pintar el grid de "PROGRAMACIÓN" en la página de radio.
 */
export async function getScheduleHandler(_request: FastifyRequest, reply: FastifyReply) {
  const shows = await getRadioSchedule();
  return reply.send({ shows });
}
