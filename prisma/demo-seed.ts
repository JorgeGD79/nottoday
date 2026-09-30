/**
 * Datos de DEMO para enseñar la web a un cliente.
 *
 *   npm run seed:demo -- --yes            borra la demo anterior y la vuelve a crear
 *   npm run seed:demo -- --reset --yes    solo borra los datos de demo
 *   npm run seed:demo -- --images         regenera las imágenes SVG de public/demo/
 *
 * Todo lo que crea lleva un id que empieza por "cdemo" (válido como cuid para
 * las validaciones del panel), así que borrarlo nunca toca datos reales. Las
 * categorías que ya existan (p. ej. "joyas") se reutilizan y no se borran.
 * Las fechas son relativas al día en que se ejecuta: siempre hay eventos
 * próximos y un archivo de eventos pasados.
 *
 * Necesita DATABASE_URL y APP_URL (la URL pública de la web: las imágenes de
 * la demo se guardan con URL absoluta, como las que se suben desde el panel).
 * No crea el usuario administrador: para eso está `npm run prisma:seed`.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BookingStatus,
  BookingType,
  DiscountType,
  DropStatus,
  EventStatus,
  FulfillmentStatus,
  NewsletterCampaignStatus,
  NewsletterDeliveryStatus,
  NewsletterStatus,
  OrderStatus,
  PrismaClient,
  ProductStatus,
  ProductType,
  TicketStatus,
} from "@prisma/client";
import { normalizeSearch } from "../src/utils/slug";

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const DEMO_PREFIX = "cdemo";
const APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");
const IMAGES_DIR = join(__dirname, "..", "public", "demo");

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Fecha a N días de hoy (negativo = pasado) a la hora indicada (hora local). */
function day(offset: number, hour = 12, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// Generador pseudoaleatorio con semilla: la demo sale igual cada vez.
let seedState = 20260930;
function rand() {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pad = (n: number, len = 2) => String(n).padStart(len, "0");
const round2 = (n: number) => Math.round(n * 100) / 100;
const image = (file: string) => (APP_URL ? [`${APP_URL}/demo/${file}`] : []);

// ---------------------------------------------------------------------------
// Imágenes (SVG con el estilo de la web: negro, líneas finas, naranja)
// ---------------------------------------------------------------------------

const ACCENT = "#ff8a00";

function wrapWords(text: string, maxChars: number) {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + word).length <= maxChars) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  return lines;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Shape = "tee" | "hoodie" | "ring" | "chain" | "disc" | "cap" | "bag" | "jacket" | "poster" | "portrait";

function shapeSvg(shape: Shape, cx: number, cy: number) {
  const stroke = `fill="none" stroke="${ACCENT}" stroke-width="6"`;
  switch (shape) {
    case "tee":
      return `<path ${stroke} d="M${cx - 150} ${cy - 120} l80 -50 h140 l80 50 l60 90 l-70 40 l-30 -40 v230 h-220 v-230 l-30 40 l-70 -40 z"/>`;
    case "hoodie":
    case "jacket":
      return `<path ${stroke} d="M${cx - 150} ${cy - 110} l70 -60 q80 60 160 0 l70 60 l60 200 l-60 20 l-30 -120 v240 h-240 v-240 l-30 120 l-60 -20 z"/>${
        shape === "jacket" ? `<line x1="${cx}" y1="${cy - 110}" x2="${cx}" y2="${cy + 250}" stroke="${ACCENT}" stroke-width="4"/>` : ""}`;
    case "ring":
      return `<circle cx="${cx}" cy="${cy + 40}" r="130" ${stroke}/><rect x="${cx - 55}" y="${cy - 150}" width="110" height="70" ${stroke}/>`;
    case "chain":
      return Array.from({ length: 5 }, (_, i) =>
        `<ellipse cx="${cx - 200 + i * 100}" cy="${cy + 40 + (i % 2) * 20}" rx="70" ry="42" ${stroke}/>`).join("");
    case "disc":
      return `<circle cx="${cx}" cy="${cy + 40}" r="190" ${stroke}/><circle cx="${cx}" cy="${cy + 40}" r="60" ${stroke}/><circle cx="${cx}" cy="${cy + 40}" r="8" fill="${ACCENT}"/>`;
    case "cap":
      return `<path ${stroke} d="M${cx - 170} ${cy + 80} q0 -200 170 -200 q170 0 170 200 z"/><path ${stroke} d="M${cx + 20} ${cy + 80} h210 q-20 40 -80 40 h-130"/>`;
    case "bag":
      return `<rect x="${cx - 150}" y="${cy - 80}" width="300" height="320" ${stroke}/><path ${stroke} d="M${cx - 80} ${cy - 80} v-60 q80 -70 160 0 v60"/>`;
    case "portrait":
      return `<circle cx="${cx}" cy="${cy - 60}" r="110" ${stroke}/><path ${stroke} d="M${cx - 200} ${cy + 260} q0 -200 200 -200 q200 0 200 200"/>`;
    case "poster":
      return Array.from({ length: 6 }, (_, i) =>
        `<line x1="${60 + i * 40}" y1="0" x2="${60 + i * 40 + 500}" y2="1000" stroke="${ACCENT}" stroke-width="3" opacity="${0.15 + i * 0.12}"/>`).join("");
  }
}

// Sin el nombre del producto: la tarjeta de la tienda ya lo pone debajo de la imagen.
function productSvg(kicker: string, shape: Shape) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <rect width="800" height="1000" fill="#0e0e0e"/>
  ${Array.from({ length: 9 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="1000" stroke="#1f1f1f" stroke-width="2"/>`).join("")}
  <text x="48" y="80" fill="${ACCENT}" font-family="Courier New, monospace" font-size="26" letter-spacing="4">${esc(kicker.toUpperCase())}</text>
  <text x="752" y="80" fill="#5c5f60" font-family="Courier New, monospace" font-size="26" text-anchor="end">NT/</text>
  ${shapeSvg(shape, 400, 470)}
  <text x="48" y="960" fill="#5c5f60" font-family="Courier New, monospace" font-size="22">NOT TODAY — DEMO</text>
</svg>`;
}

function posterSvg(title: string, dateLabel: string, venue: string, names: string[]) {
  const lines = wrapWords(title.toUpperCase(), 11).slice(0, 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <rect width="800" height="1000" fill="#0b0b0b"/>
  ${shapeSvg("poster", 0, 0)}
  <text x="48" y="90" fill="${ACCENT}" font-family="Courier New, monospace" font-size="30" letter-spacing="4">${esc(dateLabel)}</text>
  ${lines.map((l, i) => `<text x="44" y="${250 + i * 88}" fill="#f2efee" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="80">${esc(l)}</text>`).join("")}
  ${names.map((n, i) => `<text x="48" y="${760 + i * 44}" fill="${i === 0 ? ACCENT : "#c4c7c8"}" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${i === 0 ? 40 : 32}">${esc(n)}</text>`).join("")}
  <text x="48" y="950" fill="#8e9192" font-family="Courier New, monospace" font-size="24">${esc(venue.toUpperCase())}</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Contenido de la demo
// ---------------------------------------------------------------------------

const ARTISTS = [
  { key: "lumen", name: "LUMEN ROTO", bio: "Techno hipnótico y crudo. Residente de NOT TODAY desde la primera noche: sesiones largas, graves que se sienten en el pecho y cero concesiones." },
  { key: "mara", name: "MARA KØ", bio: "Productora y DJ. Mezcla electro, breaks y ambient oscuro. Su directo con máquinas es de lo más esperado de cada temporada." },
  { key: "estatica", name: "ESTÁTICA 404", bio: "Dúo de live act analógico. Sintetizadores modulares, cintas y una puesta en escena que parte de lo que se rompe." },
  { key: "cianuro", name: "DÚO CIANURO", bio: "Industrial y EBM para bailar hasta el cierre. Vienen del circuito underground y editan en el sello del colectivo." },
  { key: "nebula", name: "NÉBULA SUR", bio: "Deep house y dub techno. Sets de apertura que construyen la noche desde abajo, sin prisa." },
  { key: "ozono", name: "OZONO FM", bio: "Selector de radio y coleccionista de vinilos. Conduce BLOQUE CERO en N-TY Radio cada semana." },
  // Artistas reales de las N-TY Sessions publicadas en el canal de YouTube del
  // colectivo: la bio solo recoge lo que dice el título del vídeo.
  { key: "bigg3m", name: "BIGG3M", bio: "Protagonista de la N-TY Session Nº1: hip hop, R&B y reggaetón." },
  { key: "undercarrot", name: "UNDERCARROT", bio: "Protagonista de la N-TY Session Nº2: funk, hip hop y R&B." },
  { key: "mchardy", name: "MC HARDY", bio: "Protagonista de la N-TY Session Nº3: hip hop, R&B y underground." },
] as const;
type ArtistKey = (typeof ARTISTS)[number]["key"];

// N-TY Sessions reales del canal de YouTube de Not Today.
const SESSIONS: { title: string; youtubeUrl: string; artist: ArtistKey; description: string; daysAgo: number }[] = [
  { title: "N-TY Session Nº1", youtubeUrl: "https://www.youtube.com/watch?v=Zo2_ujkqSAU", artist: "bigg3m", description: "Hip hop, R&B y reggaetón.", daysAgo: 60 },
  { title: "N-TY Session Nº2", youtubeUrl: "https://www.youtube.com/watch?v=QgkCGRQbe-U", artist: "undercarrot", description: "Funk, hip hop y R&B.", daysAgo: 35 },
  { title: "N-TY Session Nº3", youtubeUrl: "https://www.youtube.com/watch?v=ITyjs9TqQHk", artist: "mchardy", description: "Hip hop, R&B y underground.", daysAgo: 10 },
];

const CATEGORIES = [
  { key: "camisetas", name: "Camisetas" },
  { key: "sudaderas", name: "Sudaderas" },
  { key: "accesorios", name: "Accesorios" },
  { key: "joyas", name: "Joyas" },
  { key: "vinilos", name: "Vinilos" },
] as const;
type CategoryKey = (typeof CATEGORIES)[number]["key"];

interface ProductDef {
  key: string;
  name: string;
  category: CategoryKey;
  price: number;
  weight: number;
  shape: Shape;
  description: string;
  // [talla, color, stock]
  variants: [string, string, number][];
  drop?: { releaseInDays: number; status: DropStatus };
  waitlist?: number;
}

const S_XL = ["S", "M", "L", "XL"];
const sizes = (color: string, stock: number[]) => S_XL.map((s, i): [string, string, number] => [s, color, stock[i]]);

const PRODUCTS: ProductDef[] = [
  { key: "tee-logo", name: "Camiseta Logo Estático", category: "camisetas", price: 29, weight: 220, shape: "tee",
    description: "Algodón orgánico de 240 g, corte boxy y logo serigrafiado a una tinta. Hecha en Portugal.",
    variants: [...sizes("Negro", [8, 14, 12, 6]), ...sizes("Blanco", [5, 9, 7, 3])] },
  { key: "tee-bloque", name: "Camiseta Bloque Cero", category: "camisetas", price: 32, weight: 220, shape: "tee",
    description: "Edición del programa de radio BLOQUE CERO. Estampado frontal y trasero, algodón pesado.",
    variants: sizes("Negro", [4, 2, 1, 5]) },
  { key: "tee-archivo", name: "Camiseta Archivo 2024", category: "camisetas", price: 29, weight: 220, shape: "tee",
    description: "Las fechas de la temporada 2024 en la espalda. Agotada: apúntate para saber si vuelve.",
    variants: sizes("Negro", [0, 0, 0, 0]), waitlist: 4 },
  { key: "hoodie-heavy", name: "Sudadera Heavy Not Today", category: "sudaderas", price: 65, weight: 650, shape: "hoodie",
    description: "Felpa de 450 g, capucha doble y bordado tonal en el pecho. Hombro caído y puños con canalé.",
    variants: [...sizes("Negro", [6, 10, 8, 4]), ...sizes("Gris", [3, 6, 5, 2])] },
  { key: "hoodie-raw", name: "Sudadera Cremallera Raw", category: "sudaderas", price: 72, weight: 700, shape: "jacket",
    description: "Cremallera metálica, bordes sin rematar y lavado a la piedra. Cada pieza sale ligeramente distinta.",
    variants: sizes("Negro lavado", [2, 5, 4, 3]) },
  { key: "cap", name: "Gorra Cinco Paneles", category: "accesorios", price: 25, weight: 120, shape: "cap",
    description: "Nylon técnico, cierre ajustable y logo bordado.", variants: [["Única", "Negro", 20]] },
  { key: "tote", name: "Tote Bag Colectivo", category: "accesorios", price: 15, weight: 150, shape: "bag",
    description: "Lona gruesa de algodón. Cabe un vinilo de 12\" (lo hemos probado).", variants: [["Única", "Crudo", 35]] },
  { key: "vinyl", name: "Vinilo NT001 Sesiones Vol. 1", category: "vinilos", price: 24, weight: 320, shape: "disc",
    description: "Primer lanzamiento del sello: cuatro cortes de los residentes. Vinilo de 180 g, edición de 300 copias.",
    variants: [["12\"", "", 42]] },
  { key: "ring", name: "Anillo Sello NT", category: "joyas", price: 45, weight: 30, shape: "ring",
    description: "Plata de ley 925 con el sello del colectivo grabado a mano. Talla española.",
    variants: [["12", "Plata", 3], ["14", "Plata", 5], ["16", "Plata", 6], ["18", "Plata", 4], ["20", "Plata", 2]] },
  { key: "necklace", name: "Collar Cadena Eslabón", category: "joyas", price: 55, weight: 40, shape: "chain",
    description: "Cadena de eslabón grueso, 50 cm, con placa NT. En plata o baño de oro.",
    variants: [["Única", "Plata", 7], ["Única", "Dorado", 4]] },
  { key: "earrings", name: "Pendientes Aro Mini", category: "joyas", price: 35, weight: 20, shape: "ring",
    description: "Aros de 12 mm en plata de ley. Se venden por pareja.", variants: [["Única", "Plata", 12]] },
  { key: "bracelet", name: "Pulsera Cadena Fina", category: "joyas", price: 39, weight: 20, shape: "chain",
    description: "Cadena fina con cierre de mosquetón y chapa grabada. Ajustable de 16 a 19 cm.",
    variants: [["Única", "Plata", 9]] },
  { key: "drop-jacket", name: "Drop 07 Chaqueta Night Shift", category: "sudaderas", price: 120, weight: 900, shape: "jacket",
    description: "Chaqueta técnica reflectante, 80 unidades numeradas. Sale el día del drop y no se repone.",
    variants: sizes("Negro reflectante", [15, 25, 25, 15]), drop: { releaseInDays: 6, status: DropStatus.PROXIMAMENTE }, waitlist: 6 },
  { key: "drop-tee", name: "Drop 06 Camiseta Edición Limitada", category: "camisetas", price: 45, weight: 220, shape: "tee",
    description: "Serigrafía a tres tintas sobre algodón teñido en prenda. Quedan pocas.",
    variants: sizes("Burdeos", [1, 3, 2, 0]), drop: { releaseInDays: -2, status: DropStatus.ABIERTO } },
];

interface EventDef {
  key: string;
  title: string;
  inDays: number;
  hour: number;
  venue: string;
  price: number;
  status: EventStatus;
  description: string;
  lineup: ArtistKey[];
  // Entradas: aforo (null = sin venta) y pedidos de demo a generar.
  capacity?: number | "near-sold-out";
  maxPerEmail?: number;
  nominative?: boolean;
  demoOrders?: number;
}

const EVENTS: EventDef[] = [
  { key: "e1", title: "Not Today 001 Apertura", inDays: 10, hour: 23, venue: "Nave 12 / Madrid", price: 15, status: EventStatus.PUBLICADO,
    description: "Arrancamos temporada en casa. Toda la noche, sistema de sonido reforzado y visuales en directo del colectivo.\n\nEntradas nominativas: se pide identificación en la puerta.",
    lineup: ["lumen", "mara", "estatica"], capacity: 300, maxPerEmail: 4, nominative: true, demoOrders: 18 },
  { key: "e2", title: "Bloque Cero Club Night", inDays: 24, hour: 23, venue: "Almacén 7 / Valencia", price: 12, status: EventStatus.PUBLICADO,
    description: "El programa de radio sale del estudio y se va de club. Tres horas de OZONO FM y cierre de DÚO CIANURO.",
    lineup: ["cianuro", "ozono"], capacity: "near-sold-out", maxPerEmail: 2, demoOrders: 22 },
  { key: "e3", title: "Sesión al Aire Libre", inDays: 40, hour: 18, venue: "Patio Norte / Barcelona", price: 0, status: EventStatus.PUBLICADO,
    description: "Tarde de deep house al aire libre. Entrada libre hasta completar aforo.",
    lineup: ["nebula", "ozono"] },
  { key: "e4", title: "Not Today 002 Invierno", inDays: 70, hour: 23, venue: "Nave 12 / Madrid", price: 18, status: EventStatus.BORRADOR,
    description: "Borrador: cartel aún sin cerrar.", lineup: ["lumen"], capacity: 350 },
  { key: "p1", title: "Cierre de Temporada", inDays: -30, hour: 23, venue: "Nave 12 / Madrid", price: 15, status: EventStatus.FINALIZADO,
    description: "Última noche de la temporada pasada.", lineup: ["lumen", "cianuro"], capacity: 250, demoOrders: 10 },
  { key: "p2", title: "Estática en Directo", inDays: -75, hour: 22, venue: "Sala Hangar / Bilbao", price: 12, status: EventStatus.FINALIZADO,
    description: "Presentación del live act de ESTÁTICA 404.", lineup: ["estatica", "nebula"] },
  { key: "p3", title: "Not Today 000", inDays: -120, hour: 23, venue: "Almacén 7 / Valencia", price: 10, status: EventStatus.FINALIZADO,
    description: "Donde empezó todo.", lineup: ["mara", "ozono"] },
];

const FIRST = ["Lucía", "Hugo", "Martina", "Pablo", "Sara", "Daniel", "Julia", "Álvaro", "Paula", "Mario", "Carla", "Adrián", "Irene", "Javier", "Noa", "Diego", "Elena", "Marcos", "Alba", "Iván"];
const LAST = ["García", "Martín", "López", "Sánchez", "Romero", "Navarro", "Torres", "Gil", "Ruiz", "Moreno", "Ortega", "Delgado", "Castro", "Vidal", "Serrano", "Molina"];
const personName = () => `${pick(FIRST)} ${pick(LAST)} ${pick(LAST)}`;
// DNI ficticio pero con la letra de control correcta (pasa la validación del checkout).
const personDni = () => {
  const number = between(10_000_000, 99_999_999);
  return `${number}${"TRWAGMYFPDXBNJZSQVHLCKE"[number % 23]}`;
};

// ---------------------------------------------------------------------------
// Borrado de la demo
// ---------------------------------------------------------------------------

async function resetDemo() {
  const demo = { startsWith: DEMO_PREFIX };
  // Orden: primero lo que referencia a otras tablas. También se borran los
  // pedidos de prueba que alguien haya hecho sobre productos o eventos de demo
  // (si no, sus entradas impedirían borrar el evento).
  await prisma.ticket.deleteMany({ where: { OR: [{ id: demo }, { eventId: demo }] } });
  await prisma.order.deleteMany({ where: { OR: [{ id: demo }, { items: { some: { productId: demo } } }] } });
  await prisma.stockNotification.deleteMany({ where: { id: demo } });
  await prisma.newsletterCampaign.deleteMany({ where: { id: demo } });
  await prisma.newsletterSubscriber.deleteMany({ where: { id: demo } });
  await prisma.booking.deleteMany({ where: { id: demo } });
  await prisma.discount.deleteMany({ where: { id: demo } });
  await prisma.product.deleteMany({ where: { id: demo } });
  await prisma.event.deleteMany({ where: { id: demo } });
  await prisma.session.deleteMany({ where: { id: demo } });
  await prisma.artist.deleteMany({ where: { id: demo } });
  await prisma.shippingMethod.deleteMany({ where: { id: demo } });
  await prisma.shippingZone.deleteMany({ where: { id: demo } });
  await prisma.category.deleteMany({ where: { id: demo } });
}

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

function writeImages() {
  mkdirSync(IMAGES_DIR, { recursive: true });
  for (const p of PRODUCTS) {
    const kicker = p.drop ? "Drop exclusivo" : CATEGORIES.find((c) => c.key === p.category)!.name;
    writeFileSync(join(IMAGES_DIR, `product-${p.key}.svg`), productSvg(kicker, p.shape));
  }
  for (const e of EVENTS) {
    const names = e.lineup.map((k) => ARTISTS.find((a) => a.key === k)!.name);
    // En la imagen solo el día relativo no tiene sentido: se pinta el formato de cartel genérico.
    writeFileSync(join(IMAGES_DIR, `event-${e.key}.svg`), posterSvg(e.title, "NOT TODAY PRESENTA", e.venue, names));
  }
  for (const a of ARTISTS) {
    writeFileSync(join(IMAGES_DIR, `artist-${a.key}.svg`), productSvg("Artista", "portrait"));
  }
  console.log(`Imágenes SVG escritas en ${IMAGES_DIR}`);
}

async function createDemo() {
  // --- Categorías (se reutilizan las que ya existan por slug) ---
  const categoryId = new Map<CategoryKey, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const existing = await prisma.category.findUnique({ where: { slug: c.key } });
    const cat = existing ?? (await prisma.category.create({
      data: { id: `${DEMO_PREFIX}cat${pad(i + 1)}`, name: c.name, slug: c.key, sortOrder: i * 10 },
    }));
    categoryId.set(c.key, cat.id);
  }

  // --- Artistas ---
  const artistId = new Map<ArtistKey, string>();
  for (const [i, a] of ARTISTS.entries()) {
    const id = `${DEMO_PREFIX}art${pad(i + 1)}`;
    await prisma.artist.create({ data: { id, stageName: a.name, bio: a.bio, images: image(`artist-${a.key}.svg`) } });
    artistId.set(a.key, id);
  }

  // --- N-TY Sessions ---
  for (const [i, sess] of SESSIONS.entries()) {
    await prisma.session.create({
      data: {
        id: `${DEMO_PREFIX}ses${pad(i + 1)}`,
        title: sess.title,
        youtubeUrl: sess.youtubeUrl,
        description: sess.description,
        artistId: artistId.get(sess.artist)!,
        publishedAt: day(-sess.daysAgo, 19),
      },
    });
  }

  // --- Productos de tienda y drops ---
  const variantIds = new Map<string, { id: string; label: string }[]>();
  const productRows = new Map<string, { id: string; price: number; name: string }>();
  for (const [i, p] of PRODUCTS.entries()) {
    const id = `${DEMO_PREFIX}prd${pad(i + 1)}`;
    const category = CATEGORIES.find((c) => c.key === p.category)!;
    await prisma.product.create({
      data: {
        id,
        name: p.name,
        slug: normalizeSearch(p.name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        description: p.description,
        price: p.price,
        weightGrams: p.weight,
        images: image(`product-${p.key}.svg`),
        productType: p.drop ? ProductType.DROP_EXCLUSIVO : ProductType.TIENDA_GENERAL,
        status: ProductStatus.ACTIVO,
        categoryId: categoryId.get(p.category),
        searchText: normalizeSearch(`${p.name} ${p.description} ${category.name}`),
        variants: {
          create: p.variants.map(([size, color, stock], idx) => ({
            id: `${id}v${idx}`,
            size,
            color,
            stockAvailable: stock,
            sortOrder: idx * 10,
          })),
        },
        ...(p.drop
          ? { dropMeta: { create: { releaseAt: day(p.drop.releaseInDays, 20), dropStatus: p.drop.status } } }
          : {}),
      },
    });
    variantIds.set(p.key, p.variants.map(([size, color], idx) => ({ id: `${id}v${idx}`, label: color ? `${color} / ${size}` : size })));
    productRows.set(p.key, { id, price: p.price, name: p.name });

    for (let n = 0; n < (p.waitlist ?? 0); n++) {
      await prisma.stockNotification.create({
        data: { id: `${DEMO_PREFIX}ntf${pad(i + 1)}${pad(n)}`, email: `espera${pad(i + 1)}${pad(n)}@example.com`, productId: id },
      });
    }
  }

  // --- Eventos, line-up y entradas ---
  let orderSeq = 0;
  let ticketSeq = 0;
  const ticketCode = () => randomBytes(16).toString("base64url");

  for (const [i, e] of EVENTS.entries()) {
    const id = `${DEMO_PREFIX}evt${pad(i + 1)}`;
    const date = day(e.inDays, e.hour, e.hour === 23 ? 30 : 0);
    await prisma.event.create({
      data: {
        id,
        title: e.title,
        date,
        venue: e.venue,
        description: e.description,
        posterUrl: image(`event-${e.key}.svg`)[0] ?? null,
        price: e.price,
        status: e.status,
        maxTicketsPerEmail: e.maxPerEmail ?? null,
        nominativeTickets: e.nominative ?? false,
        lineup: {
          create: e.lineup.map((k, billing) => ({
            artistId: artistId.get(k)!,
            billing,
            setTime: e.inDays > 0 ? new Date(date.getTime() + billing * 90 * 60 * 1000) : null,
          })),
        },
      },
    });
    if (!e.capacity || e.price <= 0) continue;

    // Producto-entrada (lo mismo que crea el panel al poner aforo).
    const ticketProductId = `${DEMO_PREFIX}tkt${pad(i + 1)}`;
    const variantId = `${ticketProductId}v0`;
    await prisma.product.create({
      data: {
        id: ticketProductId,
        name: `Entrada · ${e.title}`,
        slug: `entrada-${normalizeSearch(e.title).replace(/[^a-z0-9]+/g, "-")}`,
        description: e.description,
        price: e.price,
        images: image(`event-${e.key}.svg`),
        productType: ProductType.TICKET_EVENTO,
        status: e.status === EventStatus.PUBLICADO ? ProductStatus.ACTIVO : ProductStatus.BORRADOR,
        eventId: id,
        variants: { create: [{ id: variantId, size: "GENERAL", color: "", stockAvailable: 0 }] },
      },
    });

    // Pedidos de entradas (pagados; los de eventos pasados, ya validados en puerta).
    let sold = 0;
    const past = e.inDays < 0;
    for (let n = 0; n < (e.demoOrders ?? 0); n++) {
      orderSeq++;
      const orderId = `${DEMO_PREFIX}ord${pad(orderSeq, 3)}`;
      const qty = Math.min(between(1, 3), e.maxPerEmail ?? 3);
      const buyer = personName();
      const email = `${normalizeSearch(buyer.split(" ")[0])}.${pad(orderSeq, 3)}@example.com`;
      const total = round2(qty * e.price);
      const createdAt = new Date(Math.min(Date.now(), date.getTime()) - between(1, 20) * 86400000 - between(0, 23) * 3600000);
      const names = e.nominative ? [buyer, ...Array.from({ length: qty - 1 }, personName)] : [];
      const documents = names.map(() => personDni());
      const itemId = `${orderId}i0`;
      await prisma.order.create({
        data: {
          id: orderId,
          email,
          subtotal: total,
          total,
          taxAmount: round2(total - total / 1.21),
          status: OrderStatus.PAGADO,
          stripePaymentIntentId: `simulated_${orderId}`,
          shippingCountry: "ES",
          createdAt,
          items: {
            create: [{ id: itemId, productId: ticketProductId, productVariantId: variantId, quantity: qty, unitPrice: e.price,
              variantLabel: "Entrada general", attendeeNames: names, attendeeDocuments: documents }],
          },
        },
      });
      for (let t = 0; t < qty; t++) {
        ticketSeq++;
        const used = past && rand() < 0.9;
        await prisma.ticket.create({
          data: {
            id: `${DEMO_PREFIX}tck${pad(ticketSeq, 4)}`,
            code: ticketCode(),
            status: used ? TicketStatus.USADA : TicketStatus.VALIDA,
            orderId,
            orderItemId: itemId,
            eventId: id,
            holderEmail: email,
            holderName: names[t] ?? null,
            holderDocument: documents[t] ?? null,
            checkedInAt: used ? new Date(date.getTime() + between(10, 180) * 60000) : null,
          },
        });
      }
      sold += qty;
    }

    const capacity = e.capacity === "near-sold-out" ? sold + 12 : e.capacity;
    await prisma.event.update({ where: { id }, data: { capacity } });
    await prisma.productVariant.update({ where: { id: variantId }, data: { stockAvailable: capacity - sold } });
  }

  // --- Pedidos de tienda (para el panel de pedidos y el seguimiento) ---
  const shopOrders: { items: [string, number, number][]; status: OrderStatus; fulfillment: FulfillmentStatus; tracking?: string; daysAgo: number }[] = [
    { items: [["hoodie-heavy", 2, 1], ["cap", 0, 1]], status: OrderStatus.PAGADO, fulfillment: FulfillmentStatus.ENTREGADO, tracking: "ES1029384756", daysAgo: 12 },
    { items: [["tee-logo", 1, 2], ["ring", 2, 1]], status: OrderStatus.PAGADO, fulfillment: FulfillmentStatus.ENVIADO, tracking: "ES5647382910", daysAgo: 3 },
    { items: [["necklace", 1, 1], ["earrings", 0, 1]], status: OrderStatus.PAGADO, fulfillment: FulfillmentStatus.PENDIENTE, daysAgo: 1 },
    { items: [["vinyl", 0, 1], ["tote", 0, 1]], status: OrderStatus.PAGADO, fulfillment: FulfillmentStatus.PENDIENTE, daysAgo: 0 },
    { items: [["drop-tee", 1, 1]], status: OrderStatus.REEMBOLSADO, fulfillment: FulfillmentStatus.PENDIENTE, daysAgo: 2 },
  ];
  const cities = [["Calle del Pez 14, 3º B", "Madrid", "28004"], ["Carrer de Blai 22", "Barcelona", "08004"], ["Calle Colón 8", "Valencia", "46004"], ["Rúa Nova 31", "Santiago de Compostela", "15705"], ["Calle Larios 5", "Málaga", "29005"]];
  for (const [n, o] of shopOrders.entries()) {
    orderSeq++;
    const orderId = `${DEMO_PREFIX}ord${pad(orderSeq, 3)}`;
    const buyer = personName();
    const lines = o.items.map(([key, variantIdx, qty]) => {
      const product = productRows.get(key)!;
      const variant = variantIds.get(key)![variantIdx];
      return { product, variant, qty, amount: round2(product.price * qty) };
    });
    const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
    const shippingCost = subtotal >= 60 ? 0 : 4.95;
    const total = round2(subtotal + shippingCost);
    const [address, city, postal] = cities[n % cities.length];
    await prisma.order.create({
      data: {
        id: orderId,
        email: `${normalizeSearch(buyer.split(" ")[0])}.${pad(orderSeq, 3)}@example.com`,
        subtotal,
        total,
        taxAmount: round2(total - total / 1.21),
        status: o.status,
        fulfillmentStatus: o.fulfillment,
        trackingCode: o.tracking ?? null,
        stripePaymentIntentId: `simulated_${orderId}`,
        shippingMethodName: "Estándar 48/72 h",
        shippingCost,
        shippingName: buyer,
        shippingAddress: address,
        shippingCity: city,
        shippingPostalCode: postal,
        shippingCountry: "ES",
        shippingPhone: `6${between(10000000, 99999999)}`,
        refundedAt: o.status === OrderStatus.REEMBOLSADO ? day(-1) : null,
        createdAt: day(-o.daysAgo, between(9, 22), between(0, 59)),
        items: {
          create: lines.map((l, idx) => ({
            id: `${orderId}i${idx}`,
            productId: l.product.id,
            productVariantId: l.variant.id,
            quantity: l.qty,
            unitPrice: l.product.price,
            variantLabel: l.variant.label,
          })),
        },
      },
    });
  }

  // --- Envíos: solo si la web aún no tiene ninguna zona configurada ---
  if ((await prisma.shippingZone.count()) === 0) {
    await prisma.shippingZone.create({
      data: {
        id: `${DEMO_PREFIX}zon01`, name: "España peninsular y Baleares", countries: ["ES"], sortOrder: 0,
        methods: { create: [
          { id: `${DEMO_PREFIX}shp01`, name: "Estándar 48/72 h", price: 4.95, pricePerExtraKg: 1, freeOverAmount: 60, sortOrder: 0 },
          { id: `${DEMO_PREFIX}shp02`, name: "Urgente 24 h", price: 8.95, pricePerExtraKg: 1.5, sortOrder: 10 },
        ] },
      },
    });
    await prisma.shippingZone.create({
      data: {
        id: `${DEMO_PREFIX}zon02`, name: "Unión Europea", sortOrder: 10,
        countries: ["PT", "FR", "IT", "DE", "NL", "BE", "IE", "AT"],
        methods: { create: [{ id: `${DEMO_PREFIX}shp03`, name: "Europa 3/6 días", price: 12.95, pricePerExtraKg: 3, freeOverAmount: 120, sortOrder: 0 }] },
      },
    });
  }

  // --- Cupones ---
  await prisma.discount.create({
    data: { id: `${DEMO_PREFIX}dsc01`, code: "DEMO10", type: DiscountType.PORCENTAJE, value: 10, startDate: day(-30), endDate: day(365) },
  });
  await prisma.discount.create({
    data: { id: `${DEMO_PREFIX}dsc02`, code: "ENVIOGRATIS", type: DiscountType.ENVIO_GRATIS, value: 0, minPurchaseAmount: 40, startDate: day(-30), endDate: day(365) },
  });

  // --- Newsletter: suscriptores, una campaña enviada y un borrador ---
  const subscriberIds: string[] = [];
  for (let n = 1; n <= 28; n++) {
    const id = `${DEMO_PREFIX}sub${pad(n)}`;
    const unsubscribed = n > 25;
    await prisma.newsletterSubscriber.create({
      data: {
        id,
        email: `suscriptor${pad(n)}@example.com`,
        status: unsubscribed ? NewsletterStatus.BAJA : NewsletterStatus.ACTIVO,
        consentAt: day(-between(5, 120)),
        source: n % 3 === 0 ? "checkout" : "newsletter",
        unsubscribeToken: randomBytes(24).toString("base64url"),
        unsubscribedAt: unsubscribed ? day(-between(1, 4)) : null,
      },
    });
    if (!unsubscribed) subscriberIds.push(id);
  }
  const sentCampaignId = `${DEMO_PREFIX}cmp01`;
  await prisma.newsletterCampaign.create({
    data: {
      id: sentCampaignId,
      subject: "Vuelve NOT TODAY: fechas de temporada",
      preheader: "Tres noches, un drop y el primer vinilo del sello",
      heading: "Volvemos",
      body: "Después del verano volvemos con la temporada más larga que hemos hecho.\n\n## Lo que viene\n\n- **Not Today 001** en Nave 12\n- **Bloque Cero** sale de la radio y se va de club\n- El **Vinilo NT001** ya está en la tienda\n\nNos vemos en la pista.",
      status: NewsletterCampaignStatus.ENVIADA,
      recipientCount: subscriberIds.length,
      startedAt: day(-14, 10),
      sentAt: day(-14, 10, 5),
      publishedAt: day(-14, 10, 5),
      testSentAt: day(-15, 18),
      createdAt: day(-16),
    },
  });
  await prisma.newsletterDelivery.createMany({
    data: subscriberIds.map((subscriberId, n) => ({
      id: `${DEMO_PREFIX}dlv${pad(n + 1, 3)}`,
      campaignId: sentCampaignId,
      subscriberId,
      status: n === 3 ? NewsletterDeliveryStatus.FALLIDO : NewsletterDeliveryStatus.ENVIADO,
      error: n === 3 ? "El proveedor rechazó el correo (ver log)" : null,
      sentAt: n === 3 ? null : day(-14, 10, 1),
    })),
  });
  await prisma.newsletterCampaign.create({
    data: {
      id: `${DEMO_PREFIX}cmp02`,
      subject: "Joyas NT y entradas para la apertura",
      preheader: "Nueva sección en la tienda y últimas entradas",
      heading: "Estrenamos joyas",
      body: "Abrimos una sección nueva en la tienda: **anillos, collares, pendientes y pulseras** en plata de ley, con el sello del colectivo.\n\n## Próximas fechas\n\n- **Not Today 001 Apertura** · Nave 12 / Madrid · entradas nominativas\n- **Bloque Cero Club Night** · Almacén 7 / Valencia · quedan pocas\n\nCon el código **DEMO10** tienes un 10 % en tu primer pedido.",
      imageUrl: image("product-necklace.svg")[0] ?? null,
      ctaLabel: "Ver joyas",
      ctaUrl: `${APP_URL || "https://example.com"}/store.html#joyas`,
      createdAt: day(-1),
    },
  });

  // --- Bookings ---
  await prisma.booking.create({
    data: {
      id: `${DEMO_PREFIX}bkg01`, type: BookingType.COLABORACION, requesterName: "Festival Ruido Blanco", email: "booking@example.com",
      details: "Queremos que NOT TODAY cure un escenario de nuestro festival el sábado 14: line-up, visuales y una N-TY Session grabada en directo.\nServicio: SHOWCASE / LINE-UP\nMarca: Festival Ruido Blanco\nTipo de colaboración: Event Sponsorship",
      status: BookingStatus.NUEVA, createdAt: day(-1, 11),
    },
  });
  await prisma.booking.create({
    data: {
      id: `${DEMO_PREFIX}bkg02`, type: BookingType.COLABORACION, requesterName: "Estudio Grano", email: "hola@example.com",
      details: "Somos un estudio de serigrafía y nos encantaría hacer una cápsula conjunta para el próximo drop.",
      status: BookingStatus.EN_REVISION, createdAt: day(-5, 16),
    },
  });

  console.log(`Demo creada: ${ARTISTS.length} artistas, ${SESSIONS.length} sessions, ${PRODUCTS.length} productos, ${EVENTS.length} eventos, ${orderSeq} pedidos, ${ticketSeq} entradas, 28 suscriptores.`);
}

// ---------------------------------------------------------------------------

async function main() {
  if (args.has("--images")) {
    writeImages();
    if (!args.has("--yes")) return;
  }

  const url = process.env.DATABASE_URL ?? "";
  const host = url.replace(/^[^@]*@/, "").replace(/[/?].*$/, "") || "(sin DATABASE_URL)";
  if (!args.has("--yes")) {
    console.log(`Base de datos: ${host}\nEsto borra los datos de demo anteriores (ids "${DEMO_PREFIX}…") y ${args.has("--reset") ? "no crea nada" : "crea la demo de nuevo"}.\nVuelve a lanzarlo con --yes para confirmar.`);
    return;
  }
  if (!APP_URL && !args.has("--reset")) {
    console.warn("⚠ APP_URL no está definida: la demo se crea sin imágenes (la web pondrá las genéricas).");
  }

  console.log(`Base de datos: ${host}`);
  await resetDemo();
  console.log("Datos de demo anteriores borrados.");
  if (!args.has("--reset")) await createDemo();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
