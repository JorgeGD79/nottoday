import { Weekday } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CACHE_KEYS, CACHE_TTL_SECONDS, getCached, setCached } from "@/services/cache.service";

const WEEKDAY_ORDER: Weekday[] = [
  Weekday.LUNES,
  Weekday.MARTES,
  Weekday.MIERCOLES,
  Weekday.JUEVES,
  Weekday.VIERNES,
  Weekday.SABADO,
  Weekday.DOMINGO,
];

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_WEEK = SECONDS_PER_DAY * 7;

export type RadioTrackPublic = {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  durationSeconds: number;
  sortOrder: number;
};

export type RadioShowPublic = {
  id: string;
  title: string;
  host: string;
  dayOfWeek: Weekday;
  startTime: string;
  tracks: RadioTrackPublic[];
};

/**
 * Franjas activas con su playlist, cacheadas en Redis (igual que `sessions`) para
 * no golpear Postgres en cada `GET /api/radio/now`. El cálculo de "qué suena ahora"
 * se hace en memoria a partir de este snapshot, así que sigue siendo preciso al
 * segundo aunque la lista de franjas solo se refresque cada `radioSchedule` TTL.
 */
export async function getRadioSchedule(): Promise<RadioShowPublic[]> {
  const cached = await getCached<RadioShowPublic[]>(CACHE_KEYS.radioSchedule);
  if (cached) return cached;

  const shows = await prisma.radioShow.findMany({
    where: { active: true },
    include: { tracks: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });

  await setCached(CACHE_KEYS.radioSchedule, shows, CACHE_TTL_SECONDS.radioSchedule);
  return shows;
}

function parseStartTimeSeconds(startTime: string): number {
  const [hours, minutes] = startTime.split(":").map(Number);
  return hours * 3600 + minutes * 60;
}

/**
 * Convierte `now` a segundos-desde-el-lunes-00:00 en horario de Europe/Madrid,
 * usando `Intl.DateTimeFormat` (el proyecto no tiene dayjs/luxon, así que evitamos
 * añadir una dependencia solo para esto).
 */
function weeklySecondOf(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const WEEKDAY_TO_INDEX: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  const dayIndex = WEEKDAY_TO_INDEX[get("weekday")] ?? 0;
  // Intl puede devolver "24" a medianoche en vez de "00" con hour12:false.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const second = Number(get("second"));

  return dayIndex * SECONDS_PER_DAY + hour * 3600 + minute * 60 + second;
}

export type NowPlaying =
  | { show: RadioShowPublic; track: RadioTrackPublic; offsetSeconds: number }
  | { show: RadioShowPublic; track: null; offsetSeconds: null }
  | { show: null; track: null; offsetSeconds: null };

/**
 * Localiza la franja "en directo" para el instante `now` y, dentro de su
 * playlist, la pista exacta y el segundo en el que debería sonar — así todos
 * los oyentes que pulsan play escuchan el mismo punto, simulando radio en vivo.
 */
export function computeNowPlaying(shows: RadioShowPublic[], now: Date): NowPlaying {
  if (shows.length === 0) return { show: null, track: null, offsetSeconds: null };

  const timeline = shows
    .map((show) => ({
      show,
      weeklySecond: WEEKDAY_ORDER.indexOf(show.dayOfWeek) * SECONDS_PER_DAY + parseStartTimeSeconds(show.startTime),
    }))
    .sort((a, b) => a.weeklySecond - b.weeklySecond);

  const nowSecond = weeklySecondOf(now);

  // Última franja cuyo inicio sea <= ahora; si `ahora` es anterior a la primera
  // franja de la semana, la "en directo" es la última de la semana anterior.
  let current = timeline[timeline.length - 1];
  for (const entry of timeline) {
    if (entry.weeklySecond <= nowSecond) current = entry;
    else break;
  }

  const { show, weeklySecond: showStart } = current;
  const totalDuration = show.tracks.reduce((sum, t) => sum + t.durationSeconds, 0);
  if (totalDuration <= 0) return { show, track: null, offsetSeconds: null };

  let elapsed = nowSecond - showStart;
  if (elapsed < 0) elapsed += SECONDS_PER_WEEK;
  elapsed %= totalDuration;

  let acc = 0;
  for (const track of show.tracks) {
    if (elapsed < acc + track.durationSeconds) {
      return { show, track, offsetSeconds: elapsed - acc };
    }
    acc += track.durationSeconds;
  }

  // No debería llegar aquí salvo redondeos; devolvemos la última pista desde el inicio.
  const last = show.tracks[show.tracks.length - 1];
  return { show, track: last, offsetSeconds: 0 };
}
