import { readFile } from "node:fs/promises";
import path from "node:path";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DropStatus, ProductStatus, ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { CACHE_KEYS, getCached, setCached } from "@/services/cache.service";
import { escapeHtml } from "@/services/email-templates";
import { findPublicProduct } from "@/modules/public/shop/shop.controller";

// ============================================================================
// SEO: la web es HTML estático + JS, así que los buscadores y las previews de
// redes (WhatsApp, Instagram, X) no verían nada de un producto. Aquí:
//   - /producto/:slug  sirve product.html con <title>, meta description,
//     canonical, Open Graph y JSON-LD (schema.org/Product) ya rellenos, más el
//     producto embebido para que el JS lo pinte sin otra petición.
//   - /sitemap.xml y /robots.txt.
// ============================================================================

const PUBLIC_DIR = path.join(__dirname, "..", "..", "..", "..", "public");
let templateCache: string | null = null;
async function productTemplate() {
  if (!templateCache || env.NODE_ENV !== "production") {
    templateCache = await readFile(path.join(PUBLIC_DIR, "product.html"), "utf8");
  }
  return templateCache;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
// JSON dentro de <script>: sin "<" para que nadie pueda cerrar la etiqueta.
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

async function productPage(request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) {
  const slug = String(request.params.slug || "").slice(0, 120);
  const product = await findPublicProduct(slug);
  const template = await productTemplate();

  if (!product) {
    const head = `<title>Producto no encontrado · NOT TODAY</title>\n<meta name="robots" content="noindex"/>`;
    const html = template
      .replace(/<!--SEO-->[\s\S]*?<!--\/SEO-->/, head)
      .replace("<!--DATA-->", `<script>window.__PRODUCT__ = null;</script>`);
    return reply.code(404).type("text/html; charset=utf-8").send(html);
  }

  const url = `${env.APP_URL}/producto/${encodeURIComponent(product.slug)}`;
  const title = product.seoTitle || `${product.name} · NOT TODAY`;
  const description = truncate(
    product.seoDescription || (product.description || `${product.name}. NOT TODAY Collective.`).replace(/\s+/g, " "),
    160
  );
  const image = product.images[0] || `${env.APP_URL}/logo_removebg.png`;
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
    `<meta name="description" content="${escapeHtml(description)}"/>`,
    `<link rel="canonical" href="${escapeHtml(url)}"/>`,
    `<meta property="og:type" content="product"/>`,
    `<meta property="og:title" content="${escapeHtml(title)}"/>`,
    `<meta property="og:description" content="${escapeHtml(description)}"/>`,
    `<meta property="og:url" content="${escapeHtml(url)}"/>`,
    `<meta property="og:image" content="${escapeHtml(image)}"/>`,
    `<meta property="product:price:amount" content="${Number(product.price).toFixed(2)}"/>`,
    `<meta property="product:price:currency" content="EUR"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<script type="application/ld+json">${safeJson(jsonLd)}</script>`,
  ].join("\n");

  const html = template
    .replace(/<!--SEO-->[\s\S]*?<!--\/SEO-->/, head)
    .replace("<!--DATA-->", `<script>window.__PRODUCT__ = ${safeJson(product)};</script>`);
  return reply.type("text/html; charset=utf-8").header("Cache-Control", "public, max-age=60").send(html);
}

const STATIC_PAGES = [
  "", "store.html", "tickets.html", "artists.html", "sessions.html", "radio.html",
  "events.html", "services.html", "about.html", "booking.html", "newsletter.html",
];

async function sitemap(_request: FastifyRequest, reply: FastifyReply) {
  let xml = await getCached<string>(CACHE_KEYS.sitemap);
  if (!xml) {
    const [products, categories] = await Promise.all([
      prisma.product.findMany({
        where: {
          productType: { in: [ProductType.TIENDA_GENERAL, ProductType.DROP_EXCLUSIVO] },
          status: { in: [ProductStatus.ACTIVO, ProductStatus.AGOTADO] },
        },
        select: { slug: true, updatedAt: true },
      }),
      prisma.category.findMany({ where: { products: { some: { status: ProductStatus.ACTIVO } } }, select: { slug: true } }),
    ]);
    const entry = (loc: string, lastmod?: Date) =>
      `  <url><loc>${escapeHtml(loc)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`;
    xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
      ...STATIC_PAGES.map((p) => entry(`${env.APP_URL}/${p}`)),
      ...categories.map((c) => entry(`${env.APP_URL}/store.html?categoria=${encodeURIComponent(c.slug)}`)),
      ...products.map((p) => entry(`${env.APP_URL}/producto/${encodeURIComponent(p.slug)}`, p.updatedAt)),
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
  fastify.get("/producto/:slug", productPage);
  fastify.get("/sitemap.xml", sitemap);
  fastify.get("/robots.txt", robots);
}
