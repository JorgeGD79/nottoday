// ============================================================
// NOT TODAY — cliente ligero de la API pública (mismo origen)
// ============================================================

const NT_API_BASE = "/api";

/**
 * fetch con manejo de errores unificado: la API devuelve siempre
 * { error, details? } en caso de fallo (ver setErrorHandler en app.ts).
 */
async function ntApi(path, options = {}) {
  const res = await fetch(`${NT_API_BASE}${path}`, {
    // OJO con el orden: `headers` debe ir DESPUÉS de `...options`. Si va antes,
    // cuando options trae sus propias headers (p. ej. el Authorization de las
    // llamadas admin) el spread sobrescribe todo el objeto y se pierde el
    // Content-Type: application/json → el body viajaría como text/plain y el
    // backend no lo parsearía como JSON ("Expected object, received string").
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });

  const body = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const message = (body && body.error) || `Error ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.details = body && body.details;
    throw err;
  }
  return body;
}

const ntFormatMoney = (value) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(value));

// "OCT 24 / 23:00" — formato de fecha del design system
function ntFormatEventDate(iso) {
  const d = new Date(iso);
  const date = d
    .toLocaleDateString("en-GB", { month: "short", day: "2-digit" })
    .toUpperCase()
    .replace(",", "");
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} / ${time}`;
}

// Placeholder oscuro para productos/eventos sin imagen subida.
function ntPlaceholderImage(label) {
  const text = (label || "NT").slice(0, 14).toUpperCase().replace(/[^A-Z0-9 ]/g, "");
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='1000'>` +
    `<rect width='100%' height='100%' fill='%23050505'/>` +
    `<rect x='20' y='20' width='760' height='960' fill='none' stroke='%23353535' stroke-width='2'/>` +
    `<text x='50%' y='50%' fill='%23444748' font-family='monospace' font-size='42' text-anchor='middle'>${text}</text>` +
    `<text x='50%' y='58%' fill='%23ff8a00' font-family='monospace' font-size='20' text-anchor='middle'>NOT TODAY</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${svg}`;
}

function ntProductImage(product) {
  return (product.images && product.images[0]) || ntPlaceholderImage(product.name);
}

// Toast de feedback global
let ntToastTimer = null;
function ntToast(message, isError = false) {
  let el = document.getElementById("nt-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "nt-toast";
    el.className = "nt-toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("visible");
  clearTimeout(ntToastTimer);
  ntToastTimer = setTimeout(() => el.classList.remove("visible"), 3200);
}

// Extrae el videoId de cualquier formato de URL de YouTube
// (watch?v=, youtu.be/, /embed/, /shorts/, /live/).
function ntYoutubeId(url) {
  const match = String(url || "").match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/
  );
  return match ? match[1] : null;
}

function ntYoutubeThumb(url) {
  const id = ntYoutubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

function ntEscapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}
