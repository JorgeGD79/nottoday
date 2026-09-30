import { readFile } from "node:fs/promises";
import path from "node:path";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ArtistStatus, DropStatus, EventStatus, ProductStatus, ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { CACHE_KEYS, getCached, setCached } from "@/services/cache.service";
import { escapeHtml } from "@/services/email-templates";
import { findPublicProduct } from "@/modules/public/shop/shop.controller";
import { findPublicEvent } from "@/modules/public/events/events.controller";
import { findPublicArtist } from "@/modules/public/artists/artists.controller";

// ============================================================================
// SEO: la web es HTML estático + JS, así que los buscadores y las previews de
// redes (WhatsApp, Instagram, X) solo ven lo que venga en el HTML. Aquí:
//   - Las páginas públicas se sirven con meta description, canonical y Open
//     Graph (el <title> es el de cada HTML), y la home con el JSON-LD de la
//     organización.
//   - /producto/:slug, /evento/:slug, /artista/:slug y /tienda/:categoria
//     sirven su plantilla con <title>, metas y JSON-LD (schema.org) ya
//     rellenos, más los datos embebidos para que el JS los pinte sin otra
//     petición. Evento y artista dejan además su ficha en HTML (<!--SSR-->).
//   - Redirecciones 301 de URLs antiguas, /sitemap.xml y /robots.txt.
// ============================================================================

const PUBLIC_DIR = path.join(__dirname, "..", "..", "..", "..", "public");
const templateCache = new Map<string, string>();
async function template(file: string) {
  let html = templateCache.get(file);
  if (!html || env.NODE_ENV !== "production") {
    html = await readFile(path.join(PUBLIC_DIR, file), "utf8");
    templateCache.set(file, html);
  }
  return html;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
// JSON dentro de <script>: sin "<" para que nadie pueda cerrar la etiqueta.
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const absUrl = (p: string) => `${env.APP_URL}${p}`;

const SITE_NAME = "NOT TODAY";
const DEFAULT_IMAGE = absUrl("/logo_removebg.png");
const INSTAGRAM_URL = "https://www.instagram.com/nottoday.nty/";
const ORGANIZATION = {
  "@type": "Organization",
  "@id": absUrl("/#organization"),
  name: "NOT TODAY Collective",
  alternateName: ["NOT TODAY", "N-TY"],
  url: absUrl("/"),
  logo: DEFAULT_IMAGE,
  sameAs: [INSTAGRAM_URL],
};

// ---------------------------------------------------------------------------
// Montaje del <head>
// ---------------------------------------------------------------------------

interface HeadMeta {
  title: string;
  description?: string;
  /** Ruta absoluta desde la raíz ("/evento/x"). */
  path: string;
  image?: string;
  type?: string;
  noindex?: boolean;
  jsonLd?: unknown;
  extra?: string[];
}

function headTags(m: HeadMeta): string {
  const url = absUrl(m.path);
  const tags: string[] = [];
  if (m.description) tags.push(`<meta name="description" content="${escapeHtml(m.description)}"/>`);
  if (m.noindex) {
    tags.push(`<meta name="robots" content="noindex"/>`);
    return tags.join("\n");
  }
  const image = m.image || DEFAULT_IMAGE;
  tags.push(
    `<link rel="canonical" href="${escapeHtml(url)}"/>`,
    `<meta property="og:site_name" content="${SITE_NAME}"/>`,
    `<meta property="og:locale" content="es_ES"/>`,
    `<meta property="og:type" content="${m.type || "website"}"/>`,
    `<meta property="og:title" content="${escapeHtml(m.title)}"/>`,
    ...(m.description ? [`<meta property="og:description" content="${escapeHtml(m.description)}"/>`] : []),
    `<meta property="og:url" content="${escapeHtml(url)}"/>`,
    `<meta property="og:image" content="${escapeHtml(image)}"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    ...(m.extra || []),
  );
  if (m.jsonLd) tags.push(`<script type="application/ld+json">${safeJson(m.jsonLd)}</script>`);
  return tags.join("\n");
}

interface RenderOptions {
  /** Sustituye el <title> de la plantilla (páginas de detalle). */
  title?: string;
  head: string;
  /** `<script>` con los datos embebidos, en el marcador <!--DATA-->. */
  data?: string;
  /** HTML para buscadores en el marcador <!--SSR-->…<!--/SSR-->. */
  content?: string;
}

function render(html: string, o: RenderOptions): string {
  let out = html;
  if (o.title !== undefined) out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(o.title)}</title>`);
  // product.html trae su propio bloque <!--SEO--> (title + description por defecto).
  if (out.includes("<!--SEO-->")) out = out.replace(/<!--SEO-->[\s\S]*?<!--\/SEO-->/, o.head);
  else out = out.replace("</head>", `${o.head}\n</head>`);
  if (o.data) out = out.replace("<!--DATA-->", o.data);
  if (o.content !== undefined) out = out.replace(/<!--SSR-->[\s\S]*?<!--\/SSR-->/, o.content);
  return out;
}

const pageTitle = (html: string) => (html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? SITE_NAME).trim();

function sendHtml(reply: FastifyReply, html: string, status = 200) {
  return reply
    .code(status)
    .type("text/html; charset=utf-8")
    .header("Cache-Control", "public, max-age=60")
    .send(html);
}

// ---------------------------------------------------------------------------
// Páginas estáticas: descripción por página (el <title> vive en cada HTML)
// ---------------------------------------------------------------------------

interface StaticPage {
  file: string;
  path: string;
  description?: string;
  noindex?: boolean;
  jsonLd?: unknown;
}

const STATIC_PAGES: StaticPage[] = [
  {
    file: "index.html",
    path: "/",
    description:
      "NOT TODAY Collective: colectivo de música electrónica, moda y cultura underground. Eventos de techno, N-TY Sessions, N-TY Radio y tienda oficial.",
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        ORGANIZATION,
        { "@type": "WebSite", "@id": absUrl("/#website"), url: absUrl("/"), name: SITE_NAME, inLanguage: "es", publisher: { "@id": ORGANIZATION["@id"] } },
      ],
    },
  },
  {
    file: "events.html",
    path: "/events.html",
    description: "Agenda de NOT TODAY: próximas fiestas de techno, line-ups y entradas, y el archivo de eventos pasados.",
  },
  {
    file: "tickets.html",
    path: "/tickets.html",
    description: "Entradas para los próximos eventos de NOT TODAY. Aforo limitado, entrada con QR y sin reventa.",
  },
  {
    file: "artists.html",
    path: "/artists.html",
    description: "El roster de NOT TODAY: artistas y productores de industrial, hard techno y bass experimental. Bios, redes y sus N-TY Sessions.",
  },
  {
    file: "sessions.html",
    path: "/sessions.html",
    description: "N-TY Sessions: sets completos de los artistas de NOT TODAY grabados en una sola toma, sin ediciones. Míralos en YouTube.",
  },
  {
    file: "radio.html",
    path: "/radio.html",
    description: "N-TY Radio, la radio online de NOT TODAY: parrilla semanal de programas con los artistas del colectivo. Escúchala en directo.",
  },
  {
    file: "store.html",
    path: "/store.html",
    description: "Tienda oficial de NOT TODAY: ropa diseñada desde cero, joyas, drops exclusivos y merch del colectivo.",
  },
  {
    file: "services.html",
    path: "/services.html",
    description: "Servicios de NOT TODAY: producción de eventos, N-TY Sessions privadas y más, con la visión y el equipo del colectivo.",
  },
  {
    file: "booking.html",
    path: "/booking.html",
    description: "Colabora con NOT TODAY: patrocinio de eventos, cápsulas de ropa, producción de contenido y experiencias con el colectivo.",
  },
  {
    file: "about.html",
    path: "/about.html",
    description: "NOT TODAY nació en 2024: artistas y productores que graban, diseñan, montan y venden sin intermediarios. Conoce el colectivo.",
  },
  {
    file: "newsletter.html",
    path: "/newsletter.html",
    description: "Newsletter de NOT TODAY: lanzamientos, fechas y acceso anticipado al merch antes de que salga. Un correo cada dos semanas.",
  },
  { file: "privacy.html", path: "/privacy.html", description: "Política de privacidad de NOT TODAY Collective." },
  { file: "terms.html", path: "/terms.html", description: "Términos y condiciones de la web y la tienda de NOT TODAY Collective." },
  { file: "checkout.html", path: "/checkout.html", noindex: true },
  { file: "track.html", path: "/track.html", noindex: true },
];

async function serveStatic(page: StaticPage, reply: FastifyReply) {
  const html = await template(page.file);
  const head = headTags({
    title: pageTitle(html),
    description: page.description,
    path: page.path,
    noindex: page.noindex,
    jsonLd: page.jsonLd,
  });
  return sendHtml(reply, render(html, { head }));
}

// ---------------------------------------------------------------------------
// /producto/:slug
// ---------------------------------------------------------------------------

async function productPage(request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) {
  const slug = String(request.params.slug || "").slice(0, 120);
  const product = await findPublicProduct(slug);
  const html = await template("product.html");

  if (!product) {
    const head = `<title>Producto no encontrado · NOT TODAY</title>\n<meta name="robots" content="noindex"/>`;
    return sendHtml(reply, render(html, { head, data: `<script>window.__PRODUCT__ = null;</script>` }), 404);
  }

  const urlPath = `/producto/${encodeURIComponent(product.slug)}`;
  const url = absUrl(urlPath);
  const title = product.seoTitle || `${product.name} · NOT TODAY`;
  const description = truncate(
    product.seoDescription || oneLine(product.description || `${product.name}. NOT TODAY Collective.`),
    160
  );
  const image = product.images[0] || DEFAULT_IMAGE;
  const inStock = product.variants.some((v) => v.stockAvailable > 0) && product.status === ProductStatus.ACTIVO;
  const upcoming = product.dropMeta?.dropStatus === DropStatus.PROXIMAMENTE;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description,
    image: product.images.length ? product.images : [image],
    url,
    brand: { "@type": "Brand", name: "NOT TODAY" },
    ...(product.category ? { category: product.category.name } : {}),
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "EUR",
      price: Number(product.price).toFixed(2),
      availability: upcoming
        ? "https://schema.org/PreOrder"
        : inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  const head = [
    `<title>${escapeHtml(title)}</title>`,
    headTags({
      title,
      description,
      path: urlPath,
      image,
      type: "product",
      jsonLd,
      extra: [
        `<meta property="product:price:amount" content="${Number(product.price).toFixed(2)}"/>`,
        `<meta property="product:price:currency" content="EUR"/>`,
      ],
    }),
  ].join("\n");

  return sendHtml(reply, render(html, { head, data: `<script>window.__PRODUCT__ = ${safeJson(product)};</script>` }));
}

// ---------------------------------------------------------------------------
// /evento/:slug  (plantilla events.html con el evento destacado)
// ---------------------------------------------------------------------------

const TZ = "Europe/Madrid";
const fmtDate = (d: Date) =>
  d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const fmtTime = (d: Date) => d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

async function eventPage(request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) {
  const slug = String(request.params.slug || "").slice(0, 120);
  const found = await findPublicEvent(slug);
  const html = await template("events.html");

  if (!found) {
    const head = `<meta name="robots" content="noindex"/>`;
    return sendHtml(reply, render(html, { head, data: `<script>window.__EVENT__ = null;</script>` }), 404);
  }

  const { event, upcoming } = found;
  const urlPath = `/evento/${encodeURIComponent(event.slug)}`;
  const url = absUrl(urlPath);
  const names = event.lineup.map((l) => l.artist.stageName);
  const title = `${event.title} · NOT TODAY`;
  const description = truncate(
    oneLine(
      `${event.title}: ${fmtDate(event.date)}, ${fmtTime(event.date)} h en ${event.venue}.` +
        (names.length ? ` Line-up: ${names.join(", ")}.` : "") +
        (event.description ? ` ${event.description}` : "")
    ),
    160
  );
  const image = event.posterUrl || DEFAULT_IMAGE;
  const price = Number(event.tickets?.price ?? event.price);

  const offers = event.tickets
    ? {
        "@type": "Offer",
        url,
        price: price.toFixed(2),
        priceCurrency: "EUR",
        availability: event.tickets.available > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
      }
    : { "@type": "Offer", url, price: price.toFixed(2), priceCurrency: "EUR" };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: event.title,
    url,
    startDate: event.date.toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: event.venue, address: event.venue },
    image: [image],
    description,
    organizer: { "@type": "Organization", name: ORGANIZATION.name, url: ORGANIZATION.url },
    ...(names.length
      ? {
          performer: event.lineup.map((l) => ({
            "@type": "Person",
            name: l.artist.stageName,
            url: absUrl(`/artista/${encodeURIComponent(l.artist.slug)}`),
          })),
        }
      : {}),
    ...(price === 0 ? { isAccessibleForFree: true } : {}),
    offers,
  };

  const head = headTags({ title, description, path: urlPath, image, type: "website", jsonLd });

  // Ficha en HTML para quien no ejecuta JS; el JS de la página la repinta.
  const content = `
        <article class="grid grid-cols-1 md:grid-cols-12 gap-gutter">
            <img src="${escapeHtml(image)}" alt="Cartel de ${escapeHtml(event.title)}" class="md:col-span-5 w-full aspect-[4/5] object-cover"/>
            <div class="md:col-span-7 flex flex-col gap-stack-md">
                <p class="font-label-mono text-[12px] text-secondary-container uppercase tracking-widest">${escapeHtml(fmtDate(event.date))} · ${escapeHtml(fmtTime(event.date))} H · ${escapeHtml(event.venue)}</p>
                <h2 class="font-headline-xl text-[40px] md:text-[64px] text-on-surface uppercase tracking-tight leading-none">${escapeHtml(event.title)}</h2>
                ${event.description ? `<p class="font-body-md text-on-surface-variant whitespace-pre-line max-w-2xl">${escapeHtml(event.description)}</p>` : ""}
                ${names.length ? `<ul class="flex flex-col gap-1">${event.lineup.map((l) => `<li><a href="/artista/${encodeURIComponent(l.artist.slug)}">${escapeHtml(l.artist.stageName)}</a></li>`).join("")}</ul>` : ""}
                <p class="font-label-mono text-label-mono uppercase">${upcoming ? (event.tickets ? "Entradas a la venta" : "") : "Evento finalizado"}</p>
            </div>
        </article>`;

  return sendHtml(
    reply,
    render(html, { title, head, content, data: `<script>window.__EVENT__ = ${safeJson(event)};</script>` })
  );
}

// ---------------------------------------------------------------------------
// /artista/:slug  (plantilla artists.html con la ficha del artista abierta)
// ---------------------------------------------------------------------------

function artistProfiles(a: { spotifyId: string | null; soundcloudId: string | null; instagram: string | null; youtube: string | null }) {
  const urls: string[] = [];
  if (a.spotifyId) urls.push(a.spotifyId.startsWith("http") ? a.spotifyId : `https://open.spotify.com/artist/${a.spotifyId}`);
  if (a.soundcloudId) urls.push(a.soundcloudId.startsWith("http") ? a.soundcloudId : `https://soundcloud.com/${a.soundcloudId}`);
  if (a.instagram) {
    const handle = a.instagram.replace(/^@/, "");
    urls.push(handle.startsWith("http") ? handle : `https://instagram.com/${handle}`);
  }
  if (a.youtube) urls.push(a.youtube);
  return urls;
}

async function artistPage(request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) {
  const slug = String(request.params.slug || "").slice(0, 120);
  const artist = await findPublicArtist(slug);
  const html = await template("artists.html");

  if (!artist) {
    const head = `<meta name="robots" content="noindex"/>`;
    return sendHtml(reply, render(html, { head, data: `<script>window.__ARTIST__ = null;</script>` }), 404);
  }

  const urlPath = `/artista/${encodeURIComponent(artist.slug)}`;
  const title = `${artist.stageName} · NOT TODAY`;
  const description = truncate(
    oneLine(artist.bio ? `${artist.stageName}: ${artist.bio}` : `${artist.stageName}, artista del roster de NOT TODAY Collective.`),
    160
  );
  const image = artist.images[0] || DEFAULT_IMAGE;
  const profiles = artistProfiles(artist);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: artist.stageName,
    url: absUrl(urlPath),
    image: artist.images.length ? artist.images : [image],
    ...(artist.bio ? { description: oneLine(artist.bio) } : {}),
    ...(profiles.length ? { sameAs: profiles } : {}),
    memberOf: { "@type": "Organization", name: ORGANIZATION.name, url: ORGANIZATION.url },
  };

  const head = headTags({ title, description, path: urlPath, image, type: "profile", jsonLd });

  const content = `
        <article class="md:col-span-2 flex flex-col p-stack-md gap-stack-md">
            <img src="${escapeHtml(image)}" alt="${escapeHtml(artist.stageName)}" class="w-full max-w-xl aspect-[4/3] object-cover"/>
            <h2 class="font-headline-xl text-[32px] text-on-surface uppercase leading-none tracking-tighter">${escapeHtml(artist.stageName)}</h2>
            ${artist.bio ? `<p class="font-body-md text-body-md text-on-surface-variant whitespace-pre-line">${escapeHtml(artist.bio)}</p>` : ""}
            ${profiles.length ? `<ul class="flex flex-wrap gap-2">${profiles.map((u) => `<li><a href="${escapeHtml(u)}" rel="noopener noreferrer">${escapeHtml(u)}</a></li>`).join("")}</ul>` : ""}
            ${artist.sessions.length ? `<ul class="flex flex-col gap-2">${artist.sessions.map((s) => `<li><a href="/sessions.html#${escapeHtml(s.id)}">${escapeHtml(s.title)}</a></li>`).join("")}</ul>` : ""}
        </article>`;

  return sendHtml(
    reply,
    render(html, { title, head, content, data: `<script>window.__ARTIST__ = ${safeJson(artist)};</script>` })
  );
}

// ---------------------------------------------------------------------------
// /tienda/:categoria  (plantilla store.html con la pestaña de la categoría)
// ---------------------------------------------------------------------------

async function categoryPage(request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) {
  const slug = String(request.params.slug || "").slice(0, 120);
  const category = await prisma.category.findUnique({ where: { slug } });
  const html = await template("store.html");

  if (!category) {
    return sendHtml(reply, render(html, { head: `<meta name="robots" content="noindex"/>` }), 404);
  }

  const urlPath = `/tienda/${encodeURIComponent(category.slug)}`;
  const title = category.seoTitle || `${category.name} · NOT TODAY Store`;
  const description = truncate(
    category.seoDescription ||
      oneLine(category.description || `${category.name} de NOT TODAY: piezas diseñadas desde cero por el colectivo. Tienda oficial.`),
    160
  );
  const head = headTags({ title, description, path: urlPath });
  return sendHtml(reply, render(html, { title, head }));
}

// Enlaces antiguos store.html?categoria=<slug> -> /tienda/<slug> (conserva el resto de filtros).
async function storePage(request: FastifyRequest<{ Querystring: Record<string, string> }>, reply: FastifyReply) {
  const { categoria, ...rest } = request.query || {};
  if (categoria) {
    const qs = new URLSearchParams(rest).toString();
    return reply.redirect(`/tienda/${encodeURIComponent(categoria)}${qs ? `?${qs}` : ""}`, 301);
  }
  return serveStatic(STATIC_PAGES.find((p) => p.file === "store.html")!, reply);
}

// ---------------------------------------------------------------------------
// Sitemap y robots
// ---------------------------------------------------------------------------

async function sitemap(_request: FastifyRequest, reply: FastifyReply) {
  let xml = await getCached<string>(CACHE_KEYS.sitemap);
  if (!xml) {
    const storeWhere = { productType: ProductType.TIENDA_GENERAL, status: ProductStatus.ACTIVO };
    const [products, categories, events, artists] = await Promise.all([
      prisma.product.findMany({
        where: {
          productType: { in: [ProductType.TIENDA_GENERAL, ProductType.DROP_EXCLUSIVO] },
          status: { in: [ProductStatus.ACTIVO, ProductStatus.AGOTADO] },
        },
        select: { slug: true, updatedAt: true },
      }),
      prisma.category.findMany({ where: { products: { some: storeWhere } }, select: { slug: true, updatedAt: true } }),
      prisma.event.findMany({
        where: { status: { in: [EventStatus.PUBLICADO, EventStatus.FINALIZADO] } },
        select: { slug: true, updatedAt: true },
        orderBy: { date: "desc" },
      }),
      prisma.artist.findMany({ where: { status: ArtistStatus.ACTIVO }, select: { slug: true, updatedAt: true } }),
    ]);
    const entry = (loc: string, lastmod?: Date) =>
      `  <url><loc>${escapeHtml(loc)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`;
    xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
      ...STATIC_PAGES.filter((p) => !p.noindex).map((p) => entry(absUrl(p.path))),
      ...categories.map((c) => entry(absUrl(`/tienda/${encodeURIComponent(c.slug)}`), c.updatedAt)),
      ...products.map((p) => entry(absUrl(`/producto/${encodeURIComponent(p.slug)}`), p.updatedAt)),
      ...events.map((e) => entry(absUrl(`/evento/${encodeURIComponent(e.slug)}`), e.updatedAt)),
      ...artists.map((a) => entry(absUrl(`/artista/${encodeURIComponent(a.slug)}`), a.updatedAt)),
      `</urlset>`,
    ].join("\n");
    await setCached(CACHE_KEYS.sitemap, xml, 3600);
  }
  return reply.type("application/xml; charset=utf-8").send(xml);
}

function robots(_request: FastifyRequest, reply: FastifyReply) {
  return reply.type("text/plain; charset=utf-8").send(
    [
      "User-agent: *",
      "Disallow: /admin.html",
      "Disallow: /api/",
      "Disallow: /checkout.html",
      "Disallow: /track.html",
      `Sitemap: ${env.APP_URL}/sitemap.xml`,
      "",
    ].join("\n")
  );
}

export async function seoRoutes(fastify: FastifyInstance) {
  // Rutas explícitas: tienen prioridad sobre el comodín de @fastify/static.
  for (const page of STATIC_PAGES) {
    if (page.file === "store.html") continue;
    fastify.get(`/${page.file}`, (_request, reply) => serveStatic(page, reply));
  }
  fastify.get("/", (_request, reply) => serveStatic(STATIC_PAGES[0], reply));
  fastify.get("/store.html", storePage);

  fastify.get("/producto/:slug", productPage);
  fastify.get("/evento/:slug", eventPage);
  fastify.get("/artista/:slug", artistPage);
  fastify.get("/tienda/:slug", categoryPage);

  // La antigua página "Projects" es ahora Eventos.
  fastify.get("/projects.html", (_request, reply) => reply.redirect("/events.html", 301));

  fastify.get("/sitemap.xml", sitemap);
  fastify.get("/robots.txt", robots);
}
