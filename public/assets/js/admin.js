// ============================================================
// NOT TODAY — Panel de administración (vanilla JS)
//
// Consume la API privada /api/admin/* con el JWT emitido por
// POST /api/auth/login. El backend es la fuente de verdad: aquí
// solo se pintan tablas y formularios y se muestran sus errores.
// ============================================================

const ADMIN_TOKEN_KEY = "nottoday:adminToken";
const ADMIN_USER_KEY = "nottoday:adminUser";

// ---------- Auth ----------

const Auth = {
  get token() {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(ADMIN_USER_KEY));
    } catch {
      return null;
    }
  },
  save(token, user) {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
  },
};

async function adminApi(path, options = {}) {
  try {
    return await ntApi(path, {
      ...options,
      headers: { Authorization: `Bearer ${Auth.token}`, ...(options.headers || {}) },
    });
  } catch (err) {
    if (err.status === 401) {
      Auth.clear();
      showLogin("Sesión expirada. Vuelve a entrar.");
    }
    throw err;
  }
}

// Sube archivos a POST /api/admin/uploads (multipart). NO fijamos Content-Type:
// el navegador lo pone con el boundary correcto al usar FormData.
// `folder` decide la subcarpeta de Cloudinary (products/artists/events) para
// mantener la cuenta organizada en vez de un único folder "nottoday" mezclado.
async function uploadImages(files, folder) {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  const qs = folder ? `?folder=${encodeURIComponent(folder)}` : "";
  const res = await fetch(`/api/admin/uploads${qs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Auth.token}` },
    body: fd,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.error) || `Error ${res.status}`);
  return body.urls;
}

// Sube archivos a POST /api/admin/uploads/audio (multipart). Mismo criterio que uploadImages.
async function uploadAudioFiles(files) {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  const res = await fetch("/api/admin/uploads/audio", {
    method: "POST",
    headers: { Authorization: `Bearer ${Auth.token}` },
    body: fd,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.error) || `Error ${res.status}`);
  return body.urls;
}

// Descarga un PDF protegido (facturas): hace falta el Authorization header,
// así que no vale un <a href>: se pide como blob y se ofrece como archivo.
async function downloadPdf(url) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${Auth.token}` } });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error((body && body.error) || `Error ${res.status}`);
    }
    const name = (res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/);
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = href;
    a.download = name ? name[1] : "factura.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  } catch (err) {
    ntToast(err.message, true);
  }
}

// ---------- Helpers de formato ----------

const fmtShortDate = (iso) =>
  new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });

// datetime-local ⇄ ISO (los schemas del backend usan z.coerce.date())
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : undefined);

// mm:ss ⇄ segundos, para la duración de las pistas de radio.
function parseMmSs(v) {
  const s = (v || "").trim();
  const match = s.match(/^(\d+):([0-5]?\d)$/);
  if (match) return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  const asNumber = parseInt(s, 10);
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : 0;
}
const formatMmSs = (totalSeconds) => {
  const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Elimina claves vacías para no chocar con validadores .url()/.min() de Zod.
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v === undefined || v === null || (typeof v === "number" && Number.isNaN(v))) continue;
    out[k] = v;
  }
  return out;
}

function badge(text, kind = "muted") {
  return `<span class="adm-badge ${kind}">${ntEscapeHtml(text)}</span>`;
}
const statusBadge = (status) =>
  badge(status, { ACTIVO: "ok", PUBLICADO: "ok", ABIERTO: "ok", ACEPTADA: "ok", PAGADO: "ok", VALIDA: "ok",
    AGOTADO: "warn", CANCELADO: "warn", RECHAZADA: "warn", FALLIDO: "warn", REEMBOLSADO: "warn",
    ANULADA: "warn" }[status] || "muted");

const isAdminUser = () => Auth.user && Auth.user.role === "ADMIN";

// ---------- Constructores de campos de formulario ----------

const fText = (name, label, value = "", opts = {}) => `
  <div>
    <label class="nt-label">${label}</label>
    <input class="nt-input" name="${name}" type="${opts.type || "text"}" value="${ntEscapeHtml(value ?? "")}"
      placeholder="${ntEscapeHtml(opts.placeholder || "")}" ${opts.required ? "required" : ""}
      ${opts.step ? `step="${opts.step}"` : ""} ${opts.min !== undefined ? `min="${opts.min}"` : ""}
      ${opts.disabled ? "disabled" : ""} autocomplete="off"/>
  </div>`;

const fTextarea = (name, label, value = "", rows = 3) => `
  <div>
    <label class="nt-label">${label}</label>
    <textarea class="nt-input" name="${name}" rows="${rows}">${ntEscapeHtml(value ?? "")}</textarea>
  </div>`;

const fSelect = (name, label, options, value) => `
  <div>
    <label class="nt-label">${label}</label>
    <select class="nt-input" name="${name}">
      ${options.map((o) => {
        const [val, text] = Array.isArray(o) ? o : [o, o];
        return `<option value="${val}" ${String(value) === String(val) ? "selected" : ""}>${text}</option>`;
      }).join("")}
    </select>
  </div>`;

const fDatetime = (name, label, isoValue, required = false) => `
  <div>
    <label class="nt-label">${label}</label>
    <input class="nt-input" name="${name}" type="datetime-local" value="${toLocalInput(isoValue)}" ${required ? "required" : ""}/>
  </div>`;

// ---------- Campo de imágenes (adjuntar archivo → sube a Cloudinary) ----------
// Mantiene en memoria la lista de URLs de cada campo (por `id`), muestra
// miniaturas con botón de quitar, y sube los archivos elegidos. En el submit del
// formulario se leen las URLs con ImageField.get(id) (no via drawerValues).
const ImageField = {
  state: {},
  render(id, label, urls = [], multiple = true) {
    this.state[id] = Array.isArray(urls) ? [...urls] : [];
    return `
      <div>
        <label class="nt-label">${label}</label>
        <div id="${id}-previews" class="flex flex-wrap gap-2 mt-2"></div>
        <label class="inline-flex items-center gap-2 mt-2 cursor-pointer font-label-mono text-[12px] uppercase border border-outline-variant/30 px-3 py-2 text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors">
          <span class="material-symbols-outlined text-[18px]">upload</span> Adjuntar ${multiple ? "fotos" : "foto"}
          <input type="file" id="${id}-file" accept="image/*" ${multiple ? "multiple" : ""} class="hidden"/>
        </label>
        <p id="${id}-status" class="font-label-mono text-[11px] text-on-surface-variant uppercase mt-1"></p>
      </div>`;
  },
  wire(id, multiple = true, folder) {
    this.renderPreviews(id);
    const input = document.getElementById(`${id}-file`);
    if (!input) return;
    input.addEventListener("change", async () => {
      const files = [...input.files];
      if (!files.length) return;
      const status = document.getElementById(`${id}-status`);
      status.textContent = "Subiendo...";
      try {
        const urls = await uploadImages(files, folder);
        if (!multiple) this.state[id] = [];
        this.state[id].push(...urls);
        status.textContent = "";
        this.renderPreviews(id);
      } catch (err) {
        status.textContent = err.message;
      } finally {
        input.value = "";
      }
    });
  },
  renderPreviews(id) {
    const box = document.getElementById(`${id}-previews`);
    if (!box) return;
    box.innerHTML = this.state[id]
      .map(
        (url, i) => `
        <div class="relative w-20 h-20 border border-outline-variant/30 overflow-hidden">
          <img src="${ntEscapeHtml(url)}" class="w-full h-full object-cover" alt=""/>
          <button type="button" data-img-remove="${i}" title="Quitar"
            class="absolute top-0 right-0 bg-primary-container/80 text-on-surface hover:text-error leading-none p-0.5">
            <span class="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>`
      )
      .join("");
    box.querySelectorAll("[data-img-remove]").forEach((btn) =>
      btn.addEventListener("click", () => {
        this.state[id].splice(Number(btn.dataset.imgRemove), 1);
        this.renderPreviews(id);
      })
    );
  },
  get(id) {
    return this.state[id] || [];
  },
};

// ---------- Drawer ----------

const Drawer = {
  onSubmit: null,
  open(title, formHtml, onSubmit, submitLabel = "Guardar") {
    document.getElementById("drawer-title").textContent = title;
    document.getElementById("drawer-form").innerHTML = formHtml;
    document.getElementById("drawer-submit").textContent = submitLabel;
    this.onSubmit = onSubmit;
    document.getElementById("drawer-backdrop").classList.remove("hidden");
    setTimeout(() => {
      document.getElementById("drawer-backdrop").classList.remove("opacity-0");
      document.getElementById("form-drawer").classList.remove("translate-x-full");
    }, 10);
    document.body.style.overflow = "hidden";
  },
  close() {
    document.getElementById("drawer-backdrop").classList.add("opacity-0");
    document.getElementById("form-drawer").classList.add("translate-x-full");
    setTimeout(() => {
      document.getElementById("drawer-backdrop").classList.add("hidden");
      document.body.style.overflow = "";
    }, 300);
  },
};

// Lee todos los campos con name del formulario del drawer.
function drawerValues() {
  const form = document.getElementById("drawer-form");
  const values = {};
  form.querySelectorAll("[name]").forEach((el) => {
    values[el.name] = el.value.trim();
  });
  return values;
}

// ---------- Utilidades de sección ----------

const host = () => document.getElementById("section-host");
const actionsHost = () => document.getElementById("section-actions");

const newButton = (label = "+ Nuevo") =>
  `<button id="btn-new" class="bg-secondary-container text-primary-container font-headline-lg text-[18px] uppercase px-5 py-2 hover:bg-on-surface transition-colors">${label}</button>`;

function renderTable(headers, rowsHtml, emptyText) {
  if (!rowsHtml.length) {
    return `<div class="border border-outline-variant/20 p-stack-lg text-center">
      <p class="font-label-mono text-label-mono text-on-surface-variant uppercase">${emptyText}</p>
    </div>`;
  }
  return `<table class="adm-table">
    <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rowsHtml.join("")}</tbody>
  </table>`;
}

const rowActions = (id) => `
  <td class="whitespace-nowrap text-right">
    <button class="adm-icon-btn" data-edit="${id}" title="Editar"><span class="material-symbols-outlined text-[20px]">edit</span></button>
    <button class="adm-icon-btn danger" data-del="${id}" title="Eliminar"><span class="material-symbols-outlined text-[20px]">delete</span></button>
  </td>`;

function wireRowActions(items, onEdit, onDelete) {
  host().querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => onEdit(items.find((i) => i.id === btn.dataset.edit)))
  );
  host().querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const item = items.find((i) => i.id === btn.dataset.del);
      if (confirm(`¿Eliminar "${item.name || item.stageName || item.title || item.code}"? Esta acción no se puede deshacer.`)) {
        onDelete(item);
      }
    })
  );
}

async function submitAndReload(promise, section, okMessage) {
  try {
    await promise;
    ntToast(okMessage);
    Drawer.close();
    Sections[section].load();
  } catch (err) {
    ntToast(err.message, true);
  }
}

// Cache corta de artistas para selects (eventos y sessions).
async function artistOptions() {
  const { artists } = await adminApi("/admin/artists");
  return artists.map((a) => [a.id, a.stageName]);
}

// Eventos para el selector del producto TICKET_EVENTO.
async function eventOptions() {
  const { events } = await adminApi("/admin/events");
  return events.map((e) => [e.id, `${e.title} (${fmtShortDate(e.date)})`]);
}

// ============================================================
// SECCIONES
// ============================================================

// Plantillas de variantes para no teclear las tallas a mano.
const VARIANT_PRESETS = {
  "Ropa S–XL": ["S", "M", "L", "XL"],
  "Ropa XS–XXL": ["XS", "S", "M", "L", "XL", "XXL"],
  "Calzado 36–46": ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"],
  "Talla única": ["Única"],
};
const TAX_RATES = [["21", "21 % (general)"], ["10", "10 % (reducido)"], ["4", "4 % (superreducido)"], ["0", "0 % (exento)"]];

// Categorías para el selector del producto.
async function categoryOptions() {
  const { categories } = await adminApi("/admin/categories");
  return categories.map((c) => [c.id, c.name]);
}

const Sections = {
  // ---------------- PRODUCTOS ----------------
  products: {
    title: "Productos",
    icon: "checkroom",
    items: [],
    async load() {
      actionsHost().innerHTML = newButton();
      document.getElementById("btn-new").addEventListener("click", () => this.form());
      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const { products, lowStockThreshold } = await adminApi("/admin/products");
      this.items = products;
      const stockCell = (p) => {
        const active = p.variants.filter((v) => v.active);
        if (!active.length) return "—";
        return active.map((v) => {
          const available = v.stockAvailable - v.stockReserved;
          const cls = available <= 0 ? "text-error" : available <= lowStockThreshold ? "text-secondary" : "";
          return `<span class="${cls}" title="${v.stockReserved ? `${v.stockReserved} reservadas en pedidos pendientes` : ""}">${ntEscapeHtml(v.color ? `${v.color}/${v.size}` : v.size)}:${v.stockAvailable}</span>`;
        }).join(" · ");
      };
      const lowCount = products.filter((p) => p.productType !== "TICKET_EVENTO" &&
        p.variants.some((v) => v.active && v.stockAvailable - v.stockReserved <= lowStockThreshold)).length;
      const rows = products.map((p) => `
        <tr>
          <td>
            <span class="font-bold uppercase">${ntEscapeHtml(p.name)}</span>
            <span class="font-label-mono text-[11px] text-on-surface-variant block">${p.category ? ntEscapeHtml(p.category.name) : "Sin categoría"} · /${ntEscapeHtml(p.slug)}</span>
          </td>
          <td>${ntFormatMoney(p.price)}<span class="font-label-mono text-[11px] text-on-surface-variant block">IVA ${Number(p.taxRate)} %</span></td>
          <td>${badge(
            { DROP_EXCLUSIVO: "DROP", TICKET_EVENTO: "TICKET" }[p.productType] || "TIENDA",
            { DROP_EXCLUSIVO: "ok", TICKET_EVENTO: "ok" }[p.productType] || "muted"
          )}</td>
          <td>${statusBadge(p.status)}</td>
          <td class="font-label-mono text-[12px]">${stockCell(p)}</td>
          <td class="font-label-mono text-[12px]">${p._count.stockNotifications ? `<span class="text-secondary" title="Clientes esperando reposición o apertura">${p._count.stockNotifications} en espera</span>` : "—"}</td>
          <td>${p.dropMeta ? `${badge(p.dropMeta.dropStatus, p.dropMeta.dropStatus === "ABIERTO" ? "ok" : "muted")}<br/><span class="font-label-mono text-[11px] text-on-surface-variant">${fmtShortDate(p.dropMeta.releaseAt)}</span>` : "—"}</td>
          ${rowActions(p.id)}
        </tr>`);
      host().innerHTML = (lowCount
        ? `<p class="font-label-mono text-[12px] text-secondary uppercase mb-3">${lowCount} producto(s) con stock bajo (≤ ${lowStockThreshold} disponibles) · en rojo, agotado</p>`
        : "") + renderTable(
        ["Nombre", "Precio", "Tipo", "Estado", "Stock por variante", "Avisos", "Drop", ""],
        rows, "Sin productos. Crea el primero.");
      wireRowActions(this.items, (p) => this.form(p), (p) =>
        submitAndReload(adminApi(`/admin/products/${p.id}`, { method: "DELETE" }), "products", "Producto eliminado"));
    },
    variantRow(v = {}) {
      return `
        <div class="grid grid-cols-[1fr_1fr_80px_auto] gap-2 items-center" data-variant-row>
          <input class="nt-input" data-v-size placeholder="Talla (M, 42, Única...)" value="${ntEscapeHtml(v.size || "")}"/>
          <input class="nt-input" data-v-color placeholder="Color (opcional)" value="${ntEscapeHtml(v.color || "")}"/>
          <input class="nt-input text-center" data-v-stock type="number" min="0" placeholder="Stock" value="${v.stockAvailable ?? ""}"
            title="${v.stockReserved ? `${v.stockReserved} reservadas en pedidos pendientes` : ""}"/>
          <button type="button" class="adm-icon-btn danger" data-v-remove title="Quitar (se retira de la venta)"><span class="material-symbols-outlined text-[20px]">close</span></button>
        </div>`;
    },
    async form(p = null) {
      const isTicket = p?.productType === "TICKET_EVENTO";
      const [events, categories] = await Promise.all([eventOptions(), categoryOptions()]);
      const activeVariants = p ? p.variants.filter((v) => v.active && v.size !== "GENERAL") : [];
      const generalStock = p?.variants.find((v) => v.size === "GENERAL")?.stockAvailable ?? "";
      const html = `
        ${fText("name", "Nombre", p?.name, { required: true })}
        ${fSelect("categoryId", "Categoría", [["", "— Sin categoría —"], ...categories], p?.categoryId || "")}
        ${fTextarea("description", "Descripción", p?.description)}
        <div class="grid grid-cols-3 gap-3">
          ${fText("price", "Precio (EUR, IVA incl.)", p?.price, { type: "number", step: "0.01", min: 0, required: true })}
          ${fSelect("taxRate", "IVA", TAX_RATES, String(Number(p?.taxRate ?? 21)))}
          ${fText("weightGrams", "Peso envío (g)", p?.weightGrams ?? 0, { type: "number", step: "1", min: 0 })}
        </div>
        ${ImageField.render("prod-images", "Fotos del producto", p?.images || [], true)}
        ${fSelect("productType", "Tipo", [["TIENDA_GENERAL", "Tienda general"], ["DROP_EXCLUSIVO", "Drop exclusivo"], ["TICKET_EVENTO", "Ticket de evento"]], p?.productType || "TIENDA_GENERAL")}
        ${fSelect("status", "Estado", ["BORRADOR", "ACTIVO", "AGOTADO"], p?.status || "BORRADOR")}
        <div id="size-stock-fields" class="${isTicket ? "hidden" : ""}">
          <label class="nt-label">Variantes (talla / color / stock) — en el orden en que se muestran</label>
          <div class="flex flex-wrap gap-2 mt-2">
            ${Object.keys(VARIANT_PRESETS).map((k) => `<button type="button" data-preset="${k}" class="font-label-mono text-[11px] uppercase border border-outline-variant/30 px-2 py-1 text-on-surface-variant hover:border-secondary hover:text-secondary">${k}</button>`).join("")}
          </div>
          <div class="space-y-2 mt-2" id="variant-rows">
            ${(activeVariants.length ? activeVariants : [{}]).map((v) => this.variantRow(v)).join("")}
          </div>
          <button type="button" id="variant-add" class="mt-2 font-label-mono text-[12px] uppercase border border-outline-variant/30 px-3 py-1.5 text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors">+ Añadir variante</button>
          <p class="font-label-mono text-[11px] text-on-surface-variant uppercase mt-1">Quitar una variante la retira de la venta; los pedidos antiguos la conservan.</p>
        </div>
        <fieldset id="drop-fields" class="border border-secondary-container/40 p-4 space-y-4 ${(p?.productType || "TIENDA_GENERAL") === "DROP_EXCLUSIVO" ? "" : "hidden"}">
          <legend class="font-label-mono text-[12px] text-secondary uppercase px-2">Metadatos del drop</legend>
          ${fDatetime("releaseAt", "Fecha/hora de lanzamiento", p?.dropMeta?.releaseAt)}
          ${fSelect("dropStatus", "Estado del drop", ["PROXIMAMENTE", "ABIERTO", "FINALIZADO"], p?.dropMeta?.dropStatus || "PROXIMAMENTE")}
        </fieldset>
        <fieldset id="ticket-fields" class="border border-secondary-container/40 p-4 space-y-4 ${isTicket ? "" : "hidden"}">
          <legend class="font-label-mono text-[12px] text-secondary uppercase px-2">Evento del ticket</legend>
          ${events.length
            ? fSelect("eventId", "Evento", events, p?.eventId || "")
            : `<p class="font-label-mono text-[12px] text-error uppercase">Crea primero un evento en la sección Eventos.</p>`}
          ${fText("ticketCapacity", "Aforo (capacidad)", generalStock, { type: "number", step: "1", min: 0 })}
        </fieldset>
        <details class="border border-outline-variant/30 p-4" ${p?.seoTitle || p?.seoDescription ? "open" : ""}>
          <summary class="font-label-mono text-[12px] text-secondary uppercase cursor-pointer">SEO (buscadores y redes)</summary>
          <div class="space-y-4 mt-4">
            ${fText("slug", "URL: /producto/…", p?.slug, { placeholder: "se genera del nombre" })}
            ${fText("seoTitle", "Título SEO (máx. 70)", p?.seoTitle, { placeholder: "por defecto: nombre · NOT TODAY" })}
            ${fTextarea("seoDescription", "Meta descripción (máx. 160)", p?.seoDescription, 2)}
          </div>
        </details>`;

      Drawer.open(p ? "Editar producto" : "Nuevo producto", html, () => {
        const v = drawerValues();
        const variants =
          v.productType === "TICKET_EVENTO"
            ? [{ size: "GENERAL", color: "", stockAvailable: parseInt(v.ticketCapacity, 10) || 0 }]
            : [...document.querySelectorAll("[data-variant-row]")]
                .map((row) => ({
                  size: row.querySelector("[data-v-size]").value.trim(),
                  color: row.querySelector("[data-v-color]").value.trim(),
                  stockAvailable: parseInt(row.querySelector("[data-v-stock]").value, 10) || 0,
                }))
                .filter((x) => x.size);
        if (!variants.length) { ntToast("Añade al menos una variante (talla)", true); return; }
        const payload = clean({
          name: v.name,
          description: v.description,
          price: parseFloat(v.price),
          taxRate: parseFloat(v.taxRate),
          weightGrams: parseInt(v.weightGrams || "0", 10),
          productType: v.productType,
          status: v.status,
          eventId: v.productType === "TICKET_EVENTO" ? v.eventId : undefined,
          slug: v.slug,
        });
        payload.categoryId = v.categoryId || null;
        payload.seoTitle = v.seoTitle;
        payload.seoDescription = v.seoDescription;
        payload.images = ImageField.get("prod-images");
        payload.variants = variants;
        if (v.productType === "DROP_EXCLUSIVO" && v.releaseAt) {
          payload.dropMeta = { releaseAt: fromLocalInput(v.releaseAt), dropStatus: v.dropStatus };
        }
        return submitAndReload(
          p ? adminApi(`/admin/products/${p.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/products", { method: "POST", body: JSON.stringify(payload) }),
          "products", p ? "Producto actualizado" : "Producto creado");
      });

      ImageField.wire("prod-images", true, "products");
      const form = document.getElementById("drawer-form");
      form.querySelector("[name=productType]").addEventListener("change", (e) => {
        document.getElementById("drop-fields").classList.toggle("hidden", e.target.value !== "DROP_EXCLUSIVO");
        document.getElementById("ticket-fields").classList.toggle("hidden", e.target.value !== "TICKET_EVENTO");
        document.getElementById("size-stock-fields").classList.toggle("hidden", e.target.value === "TICKET_EVENTO");
      });
      const rows = document.getElementById("variant-rows");
      document.getElementById("variant-add").addEventListener("click", () => rows.insertAdjacentHTML("beforeend", this.variantRow()));
      form.addEventListener("click", (ev) => {
        const rm = ev.target.closest("[data-v-remove]");
        if (rm) rm.closest("[data-variant-row]").remove();
        const preset = ev.target.closest("[data-preset]");
        if (preset) {
          const hasData = [...rows.querySelectorAll("[data-v-size]")].some((i) => i.value.trim());
          if (hasData && !confirm("¿Sustituir las variantes actuales por la plantilla? El stock de las tallas que coincidan se mantiene.")) return;
          const stockBySize = new Map([...rows.querySelectorAll("[data-variant-row]")].map((r) =>
            [r.querySelector("[data-v-size]").value.trim().toLowerCase(), r.querySelector("[data-v-stock]").value]));
          rows.innerHTML = VARIANT_PRESETS[preset.dataset.preset]
            .map((size) => this.variantRow({ size, stockAvailable: stockBySize.get(size.toLowerCase()) ?? "" }))
            .join("");
        }
      });
    },
  },

  // ---------------- CATEGORÍAS ----------------
  categories: {
    title: "Categorías",
    icon: "category",
    items: [],
    async load() {
      actionsHost().innerHTML = newButton("+ Nueva");
      document.getElementById("btn-new").addEventListener("click", () => this.form());
      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const { categories } = await adminApi("/admin/categories");
      this.items = categories;
      const rows = categories.map((c) => `
        <tr>
          <td class="font-bold uppercase">${ntEscapeHtml(c.name)}</td>
          <td class="font-label-mono text-[12px] text-on-surface-variant">${ntEscapeHtml(c.slug)}</td>
          <td class="font-label-mono text-[12px]">${c._count.products}</td>
          <td class="font-label-mono text-[12px]">${c.sortOrder}</td>
          ${rowActions(c.id)}
        </tr>`);
      host().innerHTML = renderTable(["Nombre", "Slug", "Productos", "Orden", ""], rows,
        "Sin categorías. Crea algunas (camisetas, sudaderas, vinilos...) para que la tienda se pueda filtrar.");
      wireRowActions(this.items, (c) => this.form(c), (c) =>
        submitAndReload(adminApi(`/admin/categories/${c.id}`, { method: "DELETE" }), "categories", "Categoría eliminada"));
    },
    form(c = null) {
      const html = `
        ${fText("name", "Nombre", c?.name, { required: true, placeholder: "Sudaderas" })}
        ${fText("slug", "Slug (URL)", c?.slug, { placeholder: "se genera del nombre" })}
        ${fTextarea("description", "Descripción", c?.description)}
        ${fText("sortOrder", "Orden (menor = primero)", c?.sortOrder ?? 0, { type: "number", min: 0 })}
        ${fText("seoTitle", "Título SEO (máx. 70)", c?.seoTitle)}
        ${fTextarea("seoDescription", "Meta descripción (máx. 160)", c?.seoDescription, 2)}`;
      Drawer.open(c ? "Editar categoría" : "Nueva categoría", html, () => {
        const v = drawerValues();
        const payload = clean({ name: v.name, slug: v.slug, description: v.description, sortOrder: parseInt(v.sortOrder || "0", 10) });
        payload.seoTitle = v.seoTitle;
        payload.seoDescription = v.seoDescription;
        return submitAndReload(
          c ? adminApi(`/admin/categories/${c.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/categories", { method: "POST", body: JSON.stringify(payload) }),
          "categories", c ? "Categoría actualizada" : "Categoría creada");
      });
    },
  },

  // ---------------- ARTISTAS ----------------
  artists: {
    title: "Artistas",
    icon: "group",
    items: [],
    async load() {
      actionsHost().innerHTML = newButton();
      document.getElementById("btn-new").addEventListener("click", () => this.form());
      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const { artists } = await adminApi("/admin/artists");
      this.items = artists;
      const rows = artists.map((a) => `
        <tr>
          <td class="font-bold uppercase">${ntEscapeHtml(a.stageName)}</td>
          <td>${statusBadge(a.status)}</td>
          <td class="font-label-mono text-[12px] text-on-surface-variant">${ntEscapeHtml(a.instagram || "—")}</td>
          <td class="font-label-mono text-[12px]">${["spotifyId", "soundcloudId", "youtube"].filter((k) => a[k]).map((k) => k.replace("Id", "")).join(" · ") || "—"}</td>
          <td class="max-w-[300px] truncate text-on-surface-variant">${ntEscapeHtml(a.bio || "—")}</td>
          ${rowActions(a.id)}
        </tr>`);
      host().innerHTML = renderTable(["Nombre", "Estado", "Instagram", "Plataformas", "Bio", ""], rows, "Roster vacío.");
      wireRowActions(this.items, (a) => this.form(a), (a) =>
        submitAndReload(adminApi(`/admin/artists/${a.id}`, { method: "DELETE" }), "artists", "Artista eliminado"));
    },
    form(a = null) {
      const html = `
        ${fText("stageName", "Nombre artístico", a?.stageName, { required: true })}
        ${fTextarea("bio", "Biografía", a?.bio, 4)}
        ${fText("spotifyId", "Spotify (URL o ID)", a?.spotifyId, { placeholder: "https://open.spotify.com/artist/..." })}
        ${fText("youtube", "YouTube (URL)", a?.youtube, { placeholder: "https://www.youtube.com/@canal" })}
        ${fText("soundcloudId", "SoundCloud (usuario)", a?.soundcloudId)}
        ${fText("instagram", "Instagram (@usuario)", a?.instagram)}
        ${ImageField.render("artist-images", "Fotos", a?.images || [], true)}
        ${fSelect("status", "Estado", ["ACTIVO", "INACTIVO"], a?.status || "ACTIVO")}`;
      Drawer.open(a ? "Editar artista" : "Nuevo artista", html, () => {
        const v = drawerValues();
        const payload = clean({
          stageName: v.stageName, bio: v.bio, spotifyId: v.spotifyId, youtube: v.youtube,
          soundcloudId: v.soundcloudId, instagram: v.instagram, status: v.status,
        });
        payload.images = ImageField.get("artist-images");
        return submitAndReload(
          a ? adminApi(`/admin/artists/${a.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/artists", { method: "POST", body: JSON.stringify(payload) }),
          "artists", a ? "Artista actualizado" : "Artista creado");
      });
      ImageField.wire("artist-images", true, "artists");
    },
  },

  // ---------------- EVENTOS ----------------
  events: {
    title: "Eventos",
    icon: "event",
    items: [],
    async load() {
      actionsHost().innerHTML = newButton();
      document.getElementById("btn-new").addEventListener("click", () => this.form());
      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const { events } = await adminApi("/admin/events");
      this.items = events;
      const rows = events.map((e) => `
        <tr>
          <td class="font-bold uppercase">${ntEscapeHtml(e.title)}</td>
          <td class="font-label-mono text-[12px] whitespace-nowrap">${fmtShortDate(e.date)}</td>
          <td>${ntEscapeHtml(e.venue)}</td>
          <td>${Number(e.price) > 0 ? ntFormatMoney(e.price) : "Free"}</td>
          <td>${statusBadge(e.status)}</td>
          <td class="font-label-mono text-[12px] text-on-surface-variant">${(e.lineup || []).map((l) => ntEscapeHtml(l.artist.stageName)).join(" · ") || "—"}</td>
          ${rowActions(e.id)}
        </tr>`);
      host().innerHTML = renderTable(["Título", "Fecha", "Sala", "Precio", "Estado", "Line-up", ""], rows, "Sin eventos programados.");
      wireRowActions(this.items, (e) => this.form(e), (e) =>
        submitAndReload(adminApi(`/admin/events/${e.id}`, { method: "DELETE" }), "events", "Evento eliminado"));
    },
    async form(e = null) {
      const artists = await artistOptions();
      const lineupRow = (entry = null) => `
        <div class="flex gap-2 items-center" data-lineup-row>
          <select class="nt-input flex-grow" data-lineup-artist>
            ${artists.map(([id, name]) => `<option value="${id}" ${entry?.artistId === id ? "selected" : ""}>${ntEscapeHtml(name)}</option>`).join("")}
          </select>
          <input class="nt-input w-20 text-center" data-lineup-billing type="number" min="0" title="0 = headliner" value="${entry?.billing ?? 0}"/>
          <button type="button" class="adm-icon-btn danger" data-lineup-remove><span class="material-symbols-outlined text-[20px]">close</span></button>
        </div>`;

      const html = `
        ${fText("title", "Título", e?.title, { required: true })}
        ${fDatetime("date", "Fecha y hora", e?.date, true)}
        ${fText("venue", "Sala / Ciudad", e?.venue, { required: true, placeholder: "Nave 12 / Madrid" })}
        ${fTextarea("description", "Descripción", e?.description)}
        ${ImageField.render("event-poster", "Póster", e?.posterUrl ? [e.posterUrl] : [], false)}
        ${fText("price", "Precio entrada (EUR)", e?.price ?? 0, { type: "number", step: "0.01", min: 0 })}
        ${fSelect("status", "Estado", ["BORRADOR", "PUBLICADO", "CANCELADO", "FINALIZADO"], e?.status || "BORRADOR")}
        <div>
          <label class="nt-label">Line-up (billing: 0 = headliner)</label>
          <div class="space-y-2 mt-2" id="lineup-rows">
            ${(e?.lineup || []).map((l) => lineupRow({ artistId: l.artist.id, billing: l.billing })).join("")}
          </div>
          <button type="button" id="lineup-add" class="mt-2 font-label-mono text-[12px] uppercase border border-outline-variant/30 px-3 py-1.5 text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors" ${artists.length ? "" : "disabled"}>
            + Añadir artista
          </button>
        </div>`;

      Drawer.open(e ? "Editar evento" : "Nuevo evento", html, () => {
        const v = drawerValues();
        const lineup = [...document.querySelectorAll("[data-lineup-row]")].map((row) => ({
          artistId: row.querySelector("[data-lineup-artist]").value,
          billing: parseInt(row.querySelector("[data-lineup-billing]").value, 10) || 0,
        }));
        const payload = clean({
          title: v.title,
          date: fromLocalInput(v.date),
          venue: v.venue,
          description: v.description,
          price: parseFloat(v.price || "0"),
          status: v.status,
        });
        const poster = ImageField.get("event-poster")[0];
        if (poster) payload.posterUrl = poster;
        payload.lineup = lineup;
        return submitAndReload(
          e ? adminApi(`/admin/events/${e.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/events", { method: "POST", body: JSON.stringify(payload) }),
          "events", e ? "Evento actualizado" : "Evento creado");
      });

      ImageField.wire("event-poster", false, "events");
      document.getElementById("lineup-add").addEventListener("click", () => {
        document.getElementById("lineup-rows").insertAdjacentHTML("beforeend", lineupRow());
      });
      document.getElementById("drawer-form").addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-lineup-remove]");
        if (btn) btn.closest("[data-lineup-row]").remove();
      });
    },
  },

  // ---------------- N-TY SESSIONS ----------------
  sessions: {
    title: "N-TY Sessions",
    icon: "play_circle",
    items: [],
    async load() {
      actionsHost().innerHTML = newButton("+ Nueva");
      document.getElementById("btn-new").addEventListener("click", () => this.form());
      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const { sessions } = await adminApi("/admin/sessions");
      this.items = sessions;
      const rows = sessions.map((s) => `
        <tr>
          <td>
            <img src="${ntYoutubeThumb(s.youtubeUrl) || ntPlaceholderImage(s.title)}" alt="" class="w-24 aspect-video object-cover border border-outline-variant/20"/>
          </td>
          <td class="font-bold uppercase">${ntEscapeHtml(s.title)}</td>
          <td class="font-label-mono text-[12px] text-secondary">${ntEscapeHtml(s.artist.stageName)}</td>
          <td class="font-label-mono text-[12px] whitespace-nowrap">${fmtShortDate(s.publishedAt)}</td>
          <td><a href="${ntEscapeHtml(s.youtubeUrl)}" target="_blank" rel="noopener noreferrer" class="font-label-mono text-[12px] text-on-surface-variant hover:text-secondary transition-colors">Ver en YouTube -&gt;</a></td>
          ${rowActions(s.id)}
        </tr>`);
      host().innerHTML = renderTable(["", "Título", "Artista", "Publicada", "Vídeo", ""], rows, "Sin sesiones publicadas.");
      wireRowActions(this.items, (s) => this.form(s), (s) =>
        submitAndReload(adminApi(`/admin/sessions/${s.id}`, { method: "DELETE" }), "sessions", "Sesión eliminada"));
    },
    async form(s = null) {
      const artists = await artistOptions();
      const html = `
        ${fText("title", "Título", s?.title, { required: true, placeholder: "N-TY Session 003" })}
        ${fSelect("artistId", "Artista", artists, s?.artistId || s?.artist?.id)}
        ${fText("youtubeUrl", "URL de YouTube", s?.youtubeUrl, { required: true, placeholder: "https://www.youtube.com/watch?v=..." })}
        <div id="yt-preview" class="hidden">
          <label class="nt-label">Preview</label>
          <img class="w-full aspect-video object-cover border border-outline-variant/20" alt="Preview"/>
        </div>
        ${fTextarea("description", "Descripción", s?.description)}
        ${fDatetime("publishedAt", "Fecha de publicación", s?.publishedAt)}`;

      Drawer.open(s ? "Editar sesión" : "Nueva N-TY Session", html, () => {
        const v = drawerValues();
        const payload = clean({
          title: v.title,
          artistId: v.artistId,
          youtubeUrl: v.youtubeUrl,
          description: v.description,
          publishedAt: fromLocalInput(v.publishedAt),
        });
        return submitAndReload(
          s ? adminApi(`/admin/sessions/${s.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/sessions", { method: "POST", body: JSON.stringify(payload) }),
          "sessions", s ? "Sesión actualizada" : "Sesión publicada");
      });

      const urlInput = document.getElementById("drawer-form").querySelector("[name=youtubeUrl]");
      const preview = document.getElementById("yt-preview");
      const refreshPreview = () => {
        const thumb = ntYoutubeThumb(urlInput.value.trim());
        preview.classList.toggle("hidden", !thumb);
        if (thumb) preview.querySelector("img").src = thumb;
      };
      urlInput.addEventListener("input", refreshPreview);
      refreshPreview();
    },
  },

  // ---------------- N-TY RADIO ----------------
  radio: {
    title: "N-TY Radio",
    icon: "radio",
    items: [],
    WEEKDAYS: [
      ["LUNES", "Lunes"], ["MARTES", "Martes"], ["MIERCOLES", "Miércoles"],
      ["JUEVES", "Jueves"], ["VIERNES", "Viernes"], ["SABADO", "Sábado"], ["DOMINGO", "Domingo"],
    ],
    async load() {
      actionsHost().innerHTML = newButton("+ Nueva franja");
      document.getElementById("btn-new").addEventListener("click", () => this.form());
      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const { shows } = await adminApi("/admin/radio");
      this.items = shows;
      const dayLabel = (d) => this.WEEKDAYS.find(([v]) => v === d)?.[1] || d;
      const rows = shows.map((s) => `
        <tr>
          <td class="font-label-mono text-[12px] uppercase text-secondary">${dayLabel(s.dayOfWeek)}</td>
          <td class="font-label-mono text-[12px] whitespace-nowrap">${s.startTime}</td>
          <td class="font-bold uppercase">${ntEscapeHtml(s.title)}</td>
          <td class="font-label-mono text-[12px] text-on-surface-variant">${ntEscapeHtml(s.host)}</td>
          <td class="font-label-mono text-[12px]">${s.tracks.length} pista${s.tracks.length === 1 ? "" : "s"}</td>
          <td>${s.active ? badge("ACTIVA", "ok") : badge("INACTIVA", "muted")}</td>
          ${rowActions(s.id)}
        </tr>`);
      host().innerHTML = renderTable(["Día", "Hora", "Título", "Host", "Pistas", "Estado", ""], rows, "Sin franjas de radio.");
      wireRowActions(this.items, (s) => this.form(s), (s) =>
        submitAndReload(adminApi(`/admin/radio/${s.id}`, { method: "DELETE" }), "radio", "Franja eliminada"));
    },
    async form(s = null) {
      const trackRow = (t = null) => `
        <div class="border border-outline-variant/20 p-3 space-y-2" data-track-row>
          <div class="flex gap-2">
            <input class="nt-input flex-grow" data-track-title placeholder="Título de la pista" value="${ntEscapeHtml(t?.title || "")}"/>
            <input class="nt-input flex-grow" data-track-artist placeholder="Artista" value="${ntEscapeHtml(t?.artist || "")}"/>
          </div>
          <div class="flex gap-2 items-center">
            <input class="nt-input w-20 text-center" data-track-duration placeholder="mm:ss" value="${t ? formatMmSs(t.durationSeconds) : ""}"/>
            <input class="nt-input flex-grow" data-track-url placeholder="URL del audio" value="${ntEscapeHtml(t?.audioUrl || "")}"/>
            <label class="adm-icon-btn cursor-pointer" title="Subir audio">
              <span class="material-symbols-outlined text-[20px]">upload</span>
              <input type="file" accept="audio/*" class="hidden" data-track-file/>
            </label>
            <button type="button" class="adm-icon-btn danger" data-track-remove title="Quitar pista"><span class="material-symbols-outlined text-[20px]">close</span></button>
          </div>
          <p class="font-label-mono text-[11px] text-on-surface-variant uppercase" data-track-status></p>
        </div>`;

      const html = `
        ${fText("title", "Título de la franja", s?.title, { required: true, placeholder: "BLOQUE CERO" })}
        ${fText("host", "Host", s?.host, { required: true, placeholder: "KOLD BENNETT" })}
        <div class="flex gap-2">
          ${fSelect("dayOfWeek", "Día", this.WEEKDAYS, s?.dayOfWeek || "LUNES")}
          ${fText("startTime", "Hora de inicio", s?.startTime || "18:00", { type: "time", required: true })}
        </div>
        <label class="inline-flex items-center gap-2 font-label-mono text-[12px] uppercase text-on-surface-variant">
          <input type="checkbox" name="active" ${s?.active !== false ? "checked" : ""}/> Franja activa
        </label>
        <div>
          <label class="nt-label">Pistas (en orden de reproducción)</label>
          <div class="space-y-2 mt-2" id="track-rows">
            ${(s?.tracks || []).map((t) => trackRow(t)).join("")}
          </div>
          <button type="button" id="track-add" class="mt-2 font-label-mono text-[12px] uppercase border border-outline-variant/30 px-3 py-1.5 text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors">
            + Añadir pista
          </button>
        </div>`;

      Drawer.open(s ? "Editar franja" : "Nueva franja", html, () => {
        const v = drawerValues();
        const tracks = [...document.querySelectorAll("[data-track-row]")].map((row) => ({
          title: row.querySelector("[data-track-title]").value.trim(),
          artist: row.querySelector("[data-track-artist]").value.trim(),
          audioUrl: row.querySelector("[data-track-url]").value.trim(),
          durationSeconds: parseMmSs(row.querySelector("[data-track-duration]").value),
        }));
        const payload = clean({
          title: v.title,
          host: v.host,
          dayOfWeek: v.dayOfWeek,
          startTime: v.startTime,
        });
        payload.active = document.querySelector('[name="active"]').checked;
        payload.tracks = tracks;
        return submitAndReload(
          s ? adminApi(`/admin/radio/${s.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/radio", { method: "POST", body: JSON.stringify(payload) }),
          "radio", s ? "Franja actualizada" : "Franja creada");
      });

      document.getElementById("track-add").addEventListener("click", () => {
        document.getElementById("track-rows").insertAdjacentHTML("beforeend", trackRow());
      });
      const form = document.getElementById("drawer-form");
      form.addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-track-remove]");
        if (btn) btn.closest("[data-track-row]").remove();
      });
      form.addEventListener("change", async (ev) => {
        const input = ev.target.closest("[data-track-file]");
        if (!input || !input.files.length) return;
        const row = input.closest("[data-track-row]");
        const status = row.querySelector("[data-track-status]");
        status.textContent = "Subiendo...";
        try {
          const [url] = await uploadAudioFiles([...input.files]);
          row.querySelector("[data-track-url]").value = url;
          status.textContent = "";
        } catch (err) {
          status.textContent = err.message;
        } finally {
          input.value = "";
        }
      });
    },
  },

  // ---------------- PEDIDOS ----------------
  orders: {
    title: "Pedidos",
    icon: "package_2",
    page: 1,
    statusFilter: "",
    fulfillmentFilter: "",
    items: [],
    async load() {
      const PAY_STATUSES = ["PENDIENTE", "PAGADO", "FALLIDO", "CANCELADO", "REEMBOLSADO"];
      const FULFILLMENTS = ["PENDIENTE", "ENVIADO", "ENTREGADO"];
      actionsHost().innerHTML = `
        <select id="orders-status" class="nt-input !w-auto font-label-mono text-[12px] uppercase">
          <option value="">Pago: todos</option>
          ${PAY_STATUSES.map((s) => `<option value="${s}" ${this.statusFilter === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        <select id="orders-fulfillment" class="nt-input !w-auto font-label-mono text-[12px] uppercase">
          <option value="">Envío: todos</option>
          ${FULFILLMENTS.map((s) => `<option value="${s}" ${this.fulfillmentFilter === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        <span class="font-label-mono text-[12px] text-on-surface-variant uppercase" id="orders-pageinfo"></span>
        <button id="orders-prev" class="adm-icon-btn"><span class="material-symbols-outlined">chevron_left</span></button>
        <button id="orders-next" class="adm-icon-btn"><span class="material-symbols-outlined">chevron_right</span></button>`;
      document.getElementById("orders-status").addEventListener("change", (e) => { this.statusFilter = e.target.value; this.page = 1; this.load(); });
      document.getElementById("orders-fulfillment").addEventListener("change", (e) => { this.fulfillmentFilter = e.target.value; this.page = 1; this.load(); });

      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const params = new URLSearchParams({ page: this.page, pageSize: 25 });
      if (this.statusFilter) params.set("status", this.statusFilter);
      if (this.fulfillmentFilter) params.set("fulfillment", this.fulfillmentFilter);
      const { orders, pagination } = await adminApi(`/admin/orders?${params}`);
      this.items = orders;

      document.getElementById("orders-pageinfo").textContent = `${pagination.page} / ${Math.max(pagination.totalPages, 1)}`;
      document.getElementById("orders-prev").disabled = pagination.page <= 1;
      document.getElementById("orders-next").disabled = pagination.page >= pagination.totalPages;
      document.getElementById("orders-prev").addEventListener("click", () => { this.page--; this.load(); });
      document.getElementById("orders-next").addEventListener("click", () => { this.page++; this.load(); });

      const FULFILL_OPTS = ["PENDIENTE", "ENVIADO", "ENTREGADO"];
      const rows = orders.map((o) => `
        <tr>
          <td class="font-label-mono text-[12px] whitespace-nowrap">${fmtShortDate(o.createdAt)}</td>
          <td class="font-label-mono text-[12px]">${ntEscapeHtml(o.email)}</td>
          <td>
            <span class="font-bold">${ntFormatMoney(o.total)}</span>
            <span class="font-label-mono text-[11px] text-on-surface-variant block">
              ${ntFormatMoney(o.subtotal)}${Number(o.discountAmount) > 0 ? ` − ${ntFormatMoney(o.discountAmount)}` : ""} + envío ${Number(o.shippingCost) === 0 ? "0" : ntFormatMoney(o.shippingCost)}
            </span>
          </td>
          <td>${statusBadge(o.status)}</td>
          <td class="font-label-mono text-[12px]">${ntEscapeHtml(o.shippingMethodName || "—")}</td>
          <td class="max-w-[280px]">
            <details>
              <summary class="cursor-pointer font-label-mono text-[12px] text-secondary uppercase">Detalle</summary>
              <div class="mt-2 text-[13px] text-on-surface-variant space-y-1">
                <p class="font-bold text-on-surface">${(o.items || []).map((i) => `${i.quantity}x ${ntEscapeHtml(i.product.name)}${i.product.productType === "TICKET_EVENTO" || !i.variantLabel ? "" : ` (${ntEscapeHtml(i.variantLabel)})`}`).join("<br/>")}</p>
                <p>${ntEscapeHtml(o.shippingName || "")}<br/>${ntEscapeHtml(o.shippingAddress || "")}<br/>${ntEscapeHtml([o.shippingPostalCode, o.shippingCity, ntCountryName(o.shippingCountry)].filter(Boolean).join(", "))}${o.shippingPhone ? `<br/>Tel: ${ntEscapeHtml(o.shippingPhone)}` : ""}</p>
                ${o.billingTaxId ? `<p>Factura a: ${ntEscapeHtml(o.billingName || "")} · ${ntEscapeHtml(o.billingTaxId)}</p>` : ""}
                <p>IVA: ${o.taxExempt ? "exento (exportación)" : ntFormatMoney(o.taxAmount)}</p>
                ${o.invoiceNumber ? `<p><button type="button" class="text-secondary underline" data-pdf="/api/admin/orders/${o.id}/invoice">Factura ${ntEscapeHtml(o.invoiceNumber)}</button></p>` : ""}
                ${o.creditNoteNumber ? `<p><button type="button" class="text-secondary underline" data-pdf="/api/admin/orders/${o.id}/credit-note">Rectificativa ${ntEscapeHtml(o.creditNoteNumber)}</button></p>` : ""}
                ${o.discountCode ? `<p>Cupón: <span class="text-secondary">${ntEscapeHtml(o.discountCode.code)}</span></p>` : ""}
                ${o._count && o._count.tickets ? `<p>Entradas emitidas: <span class="text-secondary">${o._count.tickets}</span></p>` : ""}
                ${o.refundedAt ? `<p>Reembolso: ${fmtShortDate(o.refundedAt)}${o.stripeRefundId ? ` · ${ntEscapeHtml(o.stripeRefundId)}` : ""}</p>` : ""}
                <p class="font-label-mono text-[10px]">${o.id}</p>
              </div>
            </details>
          </td>
          <td class="whitespace-nowrap">
            <select class="nt-input !w-auto font-label-mono text-[12px] uppercase" data-order-fulfillment="${o.id}">
              ${FULFILL_OPTS.map((s) => `<option value="${s}" ${o.fulfillmentStatus === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
            <input type="text" class="nt-input !w-32 font-label-mono text-[11px] mt-1" placeholder="Tracking" value="${ntEscapeHtml(o.trackingCode || "")}" data-order-tracking="${o.id}"/>
          </td>
          <td class="whitespace-nowrap text-right">
            ${isAdminUser() && o.status === "PAGADO" ? `<button class="adm-icon-btn danger" data-order-refund="${o.id}" title="Reembolsar"><span class="material-symbols-outlined text-[20px]">currency_exchange</span></button>` : ""}
            ${isAdminUser() && o.status === "PENDIENTE" ? `<button class="adm-icon-btn danger" data-order-cancel="${o.id}" title="Cancelar pedido"><span class="material-symbols-outlined text-[20px]">cancel</span></button>` : ""}
          </td>
        </tr>`);
      host().innerHTML = renderTable(
        ["Fecha", "Email", "Total", "Pago", "Método envío", "Detalle", "Estado envío", ""],
        rows, "Sin pedidos todavía.");

      host().querySelectorAll("[data-pdf]").forEach((btn) =>
        btn.addEventListener("click", () => downloadPdf(btn.dataset.pdf)));
      host().querySelectorAll("[data-order-refund]").forEach((btn) =>
        btn.addEventListener("click", () => this.refundForm(this.items.find((o) => o.id === btn.dataset.orderRefund))));
      host().querySelectorAll("[data-order-cancel]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          const id = btn.dataset.orderCancel;
          if (!confirm("¿Cancelar este pedido pendiente? Se anula el pago en Stripe y se libera el stock reservado.")) return;
          try {
            const { outcome } = await adminApi(`/admin/orders/${id}/cancel`, { method: "POST", body: "{}" });
            ntToast(outcome === "paid" ? "El cliente ya había pagado: pedido confirmado" : "Pedido cancelado");
          } catch (err) {
            ntToast(err.message, true);
          }
          this.load();
        }));

      host().querySelectorAll("[data-order-fulfillment]").forEach((sel) =>
        sel.addEventListener("change", async () => {
          const id = sel.dataset.orderFulfillment;
          const tracking = host().querySelector(`[data-order-tracking="${id}"]`).value.trim();
          try {
            await adminApi(`/admin/orders/${id}/fulfillment`, {
              method: "PUT",
              body: JSON.stringify(clean({ fulfillmentStatus: sel.value, trackingCode: tracking || undefined })),
            });
            ntToast(`Pedido -> ${sel.value}`);
          } catch (err) {
            ntToast(err.message, true);
            this.load();
          }
        }));
      host().querySelectorAll("[data-order-tracking]").forEach((inp) =>
        inp.addEventListener("change", async () => {
          const id = inp.dataset.orderTracking;
          const sel = host().querySelector(`[data-order-fulfillment="${id}"]`);
          try {
            await adminApi(`/admin/orders/${id}/fulfillment`, {
              method: "PUT",
              body: JSON.stringify({ fulfillmentStatus: sel.value, trackingCode: inp.value.trim() }),
            });
            ntToast("Tracking guardado");
          } catch (err) {
            ntToast(err.message, true);
          }
        }));
    },
    refundForm(o) {
      const hasTickets = o._count && o._count.tickets > 0;
      const simulated = (o.stripePaymentIntentId || "").startsWith("simulated_");
      const html = `
        <div class="border border-outline-variant/30 p-4 space-y-2 text-[14px] text-on-surface-variant">
          <p><span class="text-on-surface font-bold">${ntFormatMoney(o.total)}</span> · ${ntEscapeHtml(o.email)}</p>
          <p class="font-bold text-on-surface">${(o.items || []).map((i) => `${i.quantity}x ${ntEscapeHtml(i.product.name)}${i.product.productType === "TICKET_EVENTO" || !i.variantLabel ? "" : ` (${ntEscapeHtml(i.variantLabel)})`}`).join("<br/>")}</p>
          <p class="font-label-mono text-[11px]">${ntEscapeHtml(o.id)}</p>
        </div>
        <p class="text-[14px] text-on-surface-variant">
          Se devuelve el importe total${simulated ? " (pago simulado en modo demo: no se llama a Stripe)" : " a la tarjeta del cliente vía Stripe"}.
          ${hasTickets ? "Las entradas del pedido quedarán anuladas y no pasarán el check-in." : ""}
          El cliente recibe un email. Esta acción no se puede deshacer.
        </p>
        <label class="inline-flex items-start gap-2 font-label-mono text-[12px] uppercase text-on-surface-variant">
          <input type="checkbox" id="refund-restock" ${o.fulfillmentStatus === "PENDIENTE" ? "checked" : ""}/>
          <span>Devolver las unidades al stock${hasTickets ? " (y el aforo de las entradas)" : ""}<br/>
          <span class="normal-case">Márcalo si el pedido no llegó a salir o ha vuelto en buen estado.</span></span>
        </label>`;
      Drawer.open("Reembolsar pedido", html, () => {
        const restock = document.getElementById("refund-restock").checked;
        return submitAndReload(
          adminApi(`/admin/orders/${o.id}/refund`, { method: "POST", body: JSON.stringify({ restock }) }),
          "orders", "Pedido reembolsado");
      }, "Reembolsar");
    },
  },

  // ---------------- PUERTA (check-in de entradas) ----------------
  // Funciona con un lector de códigos USB/Bluetooth (teclea el código + Enter
  // en el campo) o con la cámara del móvil: BarcodeDetector donde exista y jsQR
  // en el resto (Safari/iOS, Firefox); requiere https. Si no, se teclea el código.
  checkin: {
    title: "Puerta",
    icon: "qr_code_scanner",
    eventId: "",
    query: "",
    stream: null,
    scanTimer: null,
    busy: false,
    lastCode: "",
    lastCodeAt: 0,
    async load() {
      const { events } = await adminApi("/admin/events");
      const usable = events
        .filter((e) => e.status !== "BORRADOR")
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      if (!usable.length) {
        host().innerHTML = renderTable([], [], "Sin eventos publicados.");
        return;
      }
      if (!usable.some((e) => e.id === this.eventId)) {
        // Por defecto: el próximo evento (o el que empezó hace menos de 12 h).
        const cutoff = Date.now() - 12 * 3600 * 1000;
        this.eventId = (usable.find((e) => new Date(e.date).getTime() >= cutoff) || usable[usable.length - 1]).id;
      }

      actionsHost().innerHTML = `
        <select id="checkin-event" class="nt-input !w-auto font-label-mono text-[12px] uppercase">
          ${usable.map((e) => `<option value="${e.id}" ${e.id === this.eventId ? "selected" : ""}>${ntEscapeHtml(e.title)} · ${fmtShortDate(e.date)}</option>`).join("")}
        </select>`;
      document.getElementById("checkin-event").addEventListener("change", (e) => {
        this.eventId = e.target.value;
        this.load();
      });

      host().innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div class="lg:col-span-5 space-y-4">
            <form id="checkin-form" class="flex gap-2" autocomplete="off">
              <input id="checkin-code" class="nt-input font-label-mono" placeholder="Escanea o teclea el código" autofocus/>
              <button class="bg-secondary-container text-primary-container font-headline-lg text-[16px] uppercase px-4 hover:bg-on-surface transition-colors" type="submit">Validar</button>
            </form>
            <button id="checkin-camera" type="button" class="w-full font-label-mono text-[12px] uppercase border border-outline-variant/30 px-3 py-2 text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors">
              <span class="material-symbols-outlined text-[18px] align-middle mr-1">photo_camera</span><span id="checkin-camera-label">Escanear con cámara</span>
            </button>
            <video id="checkin-video" class="hidden w-full aspect-square object-cover border border-outline-variant/30 bg-black" playsinline muted></video>
            <div id="checkin-result" class="border border-outline-variant/20 p-6 text-center min-h-[140px] flex flex-col items-center justify-center">
              <p class="font-label-mono text-[12px] text-on-surface-variant uppercase">Esperando lectura…</p>
            </div>
          </div>
          <div class="lg:col-span-7 space-y-4">
            <div class="grid grid-cols-3 gap-3" id="checkin-stats"></div>
            <input id="checkin-search" class="nt-input" placeholder="Buscar por email o código" value="${ntEscapeHtml(this.query)}"/>
            <div id="checkin-list" class="overflow-x-auto"><div class="nt-skeleton h-40"></div></div>
          </div>
        </div>`;

      const codeInput = document.getElementById("checkin-code");
      document.getElementById("checkin-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const code = codeInput.value.trim();
        codeInput.value = "";
        if (code) this.checkIn(code);
      });
      document.getElementById("checkin-camera").addEventListener("click", () =>
        this.stream ? this.stopCamera() : this.startCamera());
      let searchTimer = null;
      document.getElementById("checkin-search").addEventListener("input", (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { this.query = e.target.value.trim(); this.loadList(); }, 250);
      });
      await this.loadList();
      codeInput.focus();
    },
    async loadList() {
      const params = new URLSearchParams({ eventId: this.eventId });
      if (this.query) params.set("q", this.query);
      const { tickets, stats } = await adminApi(`/admin/tickets?${params}`);
      const stat = (label, value, kind = "") => `
        <div class="border border-outline-variant/20 p-3 text-center">
          <p class="font-headline-lg text-[28px] leading-none ${kind}">${value}</p>
          <p class="font-label-mono text-[11px] text-on-surface-variant uppercase mt-1">${label}</p>
        </div>`;
      const statsEl = document.getElementById("checkin-stats");
      const list = document.getElementById("checkin-list");
      if (!statsEl || !list) return; // se cambió de sección mientras cargaba
      statsEl.innerHTML =
        stat("Vendidas", stats.sold) + stat("Dentro", stats.used, "text-secondary") + stat("Pendientes", stats.valid);
      const rows = tickets.map((t) => `
        <tr>
          <td class="font-label-mono text-[12px]">${ntEscapeHtml(t.holderEmail)}</td>
          <td class="font-label-mono text-[11px] text-on-surface-variant" title="${ntEscapeHtml(t.code)}">${ntEscapeHtml(t.code.slice(0, 8))}…</td>
          <td>${statusBadge(t.status)}</td>
          <td class="font-label-mono text-[11px] text-on-surface-variant whitespace-nowrap">${t.checkedInAt ? `${fmtShortDate(t.checkedInAt)}${t.checkedInBy ? `<br/>${ntEscapeHtml(t.checkedInBy.name)}` : ""}` : "—"}</td>
          <td class="text-right">${t.status === "VALIDA" ? `<button class="adm-icon-btn" data-checkin="${ntEscapeHtml(t.code)}" title="Validar a mano"><span class="material-symbols-outlined text-[20px]">how_to_reg</span></button>` : ""}</td>
        </tr>`);
      list.innerHTML = renderTable(["Email", "Código", "Estado", "Check-in", ""], rows,
        this.query ? "Sin resultados." : "Aún no hay entradas vendidas para este evento.");
      list.querySelectorAll("[data-checkin]").forEach((btn) =>
        btn.addEventListener("click", () => {
          if (confirm("¿Validar esta entrada a mano?")) this.checkIn(btn.dataset.checkin);
        }));
    },
    async checkIn(code) {
      if (this.busy) return;
      this.busy = true;
      const render = (ok, title, lines) => {
        const box = document.getElementById("checkin-result");
        if (!box) return;
        box.className = `border-2 p-6 text-center min-h-[140px] flex flex-col items-center justify-center ${ok ? "border-secondary-container bg-secondary-container/10" : "border-error bg-error-container/20"}`;
        box.innerHTML = `
          <span class="material-symbols-outlined text-[48px] ${ok ? "text-secondary-container" : "text-error"}">${ok ? "check_circle" : "block"}</span>
          <p class="font-headline-lg text-[28px] uppercase leading-none mt-2 ${ok ? "text-on-surface" : "text-error"}">${ntEscapeHtml(title)}</p>
          ${lines.filter(Boolean).map((l) => `<p class="font-label-mono text-[12px] text-on-surface-variant mt-2">${ntEscapeHtml(l)}</p>`).join("")}`;
      };
      try {
        const { ticket } = await adminApi("/admin/tickets/check-in", {
          method: "POST",
          body: JSON.stringify({ code, eventId: this.eventId }),
        });
        render(true, "Adelante", [ticket.holderEmail, ticket.event.title]);
        if (navigator.vibrate) navigator.vibrate(80);
      } catch (err) {
        const t = err.details && err.details.ticket;
        render(false, err.message, [
          t && t.holderEmail,
          t && t.checkedInAt ? `Validada: ${fmtShortDate(t.checkedInAt)}` : "",
        ]);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      } finally {
        this.busy = false;
        this.loadList().catch(() => {});
      }
    },
    // Lector de QR: BarcodeDetector nativo si existe (Chrome/Android) o jsQR
    // sobre un canvas (Safari/iOS y Firefox no tienen BarcodeDetector).
    async createDetector() {
      if ("BarcodeDetector" in window) {
        try {
          const formats = await BarcodeDetector.getSupportedFormats();
          if (formats.includes("qr_code")) return new BarcodeDetector({ formats: ["qr_code"] });
        } catch {
          /* API presente pero inservible: usamos jsQR */
        }
      }
      if (!window.jsQR) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "assets/js/vendor/jsQR.js";
          s.onload = resolve;
          s.onerror = () => reject(new Error("no se pudo cargar el lector de QR"));
          document.head.appendChild(s);
        });
      }
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      return {
        async detect(video) {
          // Reducido a 640px de lado mayor: suficiente para un QR y rápido en móvil.
          const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const hit = window.jsQR(data, width, height, { inversionAttempts: "dontInvert" });
          return hit ? [{ rawValue: hit.data }] : [];
        },
      };
    },
    async startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        ntToast(window.isSecureContext
          ? "Este navegador no da acceso a la cámara. Usa un lector USB o teclea el código."
          : "La cámara solo funciona con https.", true);
        return;
      }
      try {
        const detector = await this.createDetector();
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = document.getElementById("checkin-video");
        video.srcObject = this.stream;
        video.classList.remove("hidden");
        await video.play();
        document.getElementById("checkin-camera-label").textContent = "Parar cámara";
        this.scanTimer = setInterval(async () => {
          if (this.busy || video.readyState < 2) return;
          try {
            const [hit] = await detector.detect(video);
            if (!hit) return;
            // El mismo QR sigue delante de la cámara: no lo revalidamos durante 3 s.
            const now = Date.now();
            if (hit.rawValue === this.lastCode && now - this.lastCodeAt < 3000) return;
            this.lastCode = hit.rawValue;
            this.lastCodeAt = now;
            this.checkIn(hit.rawValue);
          } catch {
            /* frame no legible: seguimos */
          }
        }, 300);
      } catch (err) {
        this.stopCamera();
        ntToast(`No se pudo abrir la cámara: ${err.message}`, true);
      }
    },
    stopCamera() {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      const video = document.getElementById("checkin-video");
      if (video) { video.srcObject = null; video.classList.add("hidden"); }
      const label = document.getElementById("checkin-camera-label");
      if (label) label.textContent = "Escanear con cámara";
    },
    unload() {
      this.stopCamera();
    },
  },

  // ---------------- ENVÍOS (zonas por país + métodos con tarifa por peso) ----------------
  shipping: {
    title: "Envíos",
    icon: "local_shipping",
    items: [],
    zones: [],
    async load() {
      actionsHost().innerHTML = `
        <button id="btn-new-zone" class="font-label-mono text-[12px] uppercase border border-outline-variant/30 px-4 py-2 text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors">+ Zona</button>
        ${newButton("+ Método")}`;
      document.getElementById("btn-new").addEventListener("click", () => this.form());
      document.getElementById("btn-new-zone").addEventListener("click", () => this.zoneForm());
      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const { methods, zones } = await adminApi("/admin/shipping");
      this.items = methods;
      this.zones = zones;

      const zoneRows = zones.map((z) => `
        <tr>
          <td class="font-bold uppercase">${ntEscapeHtml(z.name)}</td>
          <td class="font-label-mono text-[12px] text-on-surface-variant max-w-[360px]">${z.restOfWorld ? "Resto del mundo" : z.countries.map((c) => ntEscapeHtml(ntCountryName(c))).join(", ") || "—"}</td>
          <td>${z.taxExempt ? badge("SIN IVA", "warn") : badge("IVA", "muted")}</td>
          <td class="font-label-mono text-[12px]">${z._count.methods}</td>
          <td class="whitespace-nowrap text-right">
            <button class="adm-icon-btn" data-zone-edit="${z.id}" title="Editar"><span class="material-symbols-outlined text-[20px]">edit</span></button>
            <button class="adm-icon-btn danger" data-zone-del="${z.id}" title="Eliminar"><span class="material-symbols-outlined text-[20px]">delete</span></button>
          </td>
        </tr>`);
      const weightInfo = (m) => [
        Number(m.pricePerExtraKg) > 0 ? `+${ntFormatMoney(m.pricePerExtraKg)}/kg extra` : "",
        m.maxWeightGrams ? `máx. ${m.maxWeightGrams / 1000} kg` : "",
        m.freeOverAmount !== null ? `gratis desde ${ntFormatMoney(m.freeOverAmount)}` : "",
      ].filter(Boolean).join(" · ") || "—";
      const rows = methods.map((m) => `
        <tr>
          <td class="font-bold uppercase">${ntEscapeHtml(m.name)}<span class="font-body-md normal-case font-normal text-[12px] text-on-surface-variant block">${ntEscapeHtml(m.description || "")}</span></td>
          <td class="font-label-mono text-[12px]">${m.zone ? ntEscapeHtml(m.zone.name) : "Cualquier país"}</td>
          <td class="font-label-mono">${Number(m.price) === 0 ? "Gratis" : ntFormatMoney(m.price)}</td>
          <td class="font-label-mono text-[12px] text-on-surface-variant">${weightInfo(m)}</td>
          <td>${badge(m.active ? "ACTIVO" : "INACTIVO", m.active ? "ok" : "muted")}</td>
          ${rowActions(m.id)}
        </tr>`);

      host().innerHTML = `
        <h3 class="font-label-mono text-[12px] text-secondary uppercase mb-2">Zonas (países)</h3>
        ${renderTable(["Zona", "Países", "IVA", "Métodos", ""], zoneRows,
          "Sin zonas: todos los métodos valen para cualquier país. Crea zonas (España, UE, resto del mundo) para cobrar distinto según destino.")}
        <h3 class="font-label-mono text-[12px] text-secondary uppercase mt-8 mb-2">Métodos de envío</h3>
        ${renderTable(["Nombre", "Zona", "Base (1er kg)", "Peso / gratis", "Estado", ""], rows,
          "Sin métodos de envío. Crea el primero para habilitar el checkout con envío.")}`;

      wireRowActions(this.items, (m) => this.form(m), (m) =>
        submitAndReload(adminApi(`/admin/shipping/${m.id}`, { method: "DELETE" }), "shipping", "Método eliminado"));
      host().querySelectorAll("[data-zone-edit]").forEach((b) =>
        b.addEventListener("click", () => this.zoneForm(this.zones.find((z) => z.id === b.dataset.zoneEdit))));
      host().querySelectorAll("[data-zone-del]").forEach((b) =>
        b.addEventListener("click", () => {
          const z = this.zones.find((x) => x.id === b.dataset.zoneDel);
          if (confirm(`¿Eliminar la zona "${z.name}"?`)) {
            submitAndReload(adminApi(`/admin/shipping/zones/${z.id}`, { method: "DELETE" }), "shipping", "Zona eliminada");
          }
        }));
    },
    form(m = null) {
      const zoneOpts = [["", "Cualquier país"], ...this.zones.map((z) => [z.id, z.name])];
      const html = `
        ${fText("name", "Nombre", m?.name, { required: true, placeholder: "Estándar 48/72h" })}
        ${fText("description", "Descripción", m?.description, { placeholder: "Península. Entrega en 2-3 días laborables" })}
        ${fSelect("zoneId", "Zona", zoneOpts, m?.zoneId || "")}
        <div class="grid grid-cols-2 gap-3">
          ${fText("price", "Precio base, 1er kg (EUR)", m?.price ?? "", { type: "number", step: "0.01", min: 0, required: true })}
          ${fText("pricePerExtraKg", "Por kg extra (EUR)", m?.pricePerExtraKg ?? 0, { type: "number", step: "0.01", min: 0 })}
          ${fText("maxWeightKg", "Peso máximo (kg, vacío = sin límite)", m?.maxWeightGrams ? m.maxWeightGrams / 1000 : "", { type: "number", step: "0.1", min: 0 })}
          ${fText("freeOverAmount", "Gratis desde (EUR, vacío = nunca)", m?.freeOverAmount ?? "", { type: "number", step: "0.01", min: 0 })}
        </div>
        ${fSelect("active", "Visible en el checkout", [["true", "Sí"], ["false", "No"]], String(m?.active ?? true))}
        ${fText("sortOrder", "Orden (menor = primero)", m?.sortOrder ?? 0, { type: "number", min: 0 })}
        <p class="font-label-mono text-[11px] text-on-surface-variant uppercase">Precios con IVA incluido. El peso sale de la suma de los productos del pedido.</p>`;
      Drawer.open(m ? "Editar método de envío" : "Nuevo método de envío", html, () => {
        const v = drawerValues();
        const payload = clean({
          name: v.name,
          description: v.description,
          price: parseFloat(v.price),
          pricePerExtraKg: parseFloat(v.pricePerExtraKg || "0"),
          sortOrder: parseInt(v.sortOrder || "0", 10),
        });
        payload.zoneId = v.zoneId || null;
        payload.maxWeightGrams = v.maxWeightKg ? Math.round(parseFloat(v.maxWeightKg) * 1000) : null;
        payload.freeOverAmount = v.freeOverAmount !== "" ? parseFloat(v.freeOverAmount) : null;
        payload.active = v.active === "true";
        return submitAndReload(
          m ? adminApi(`/admin/shipping/${m.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/shipping", { method: "POST", body: JSON.stringify(payload) }),
          "shipping", m ? "Método actualizado" : "Método creado");
      });
    },
    zoneForm(z = null) {
      const selected = new Set(z?.countries || []);
      const EU = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];
      const html = `
        ${fText("name", "Nombre", z?.name, { required: true, placeholder: "España peninsular / UE / Resto del mundo" })}
        <label class="inline-flex items-center gap-2 font-label-mono text-[12px] uppercase text-on-surface-variant">
          <input type="checkbox" id="zone-row" ${z?.restOfWorld ? "checked" : ""}/> Resto del mundo (países que no estén en otra zona)
        </label>
        <label class="inline-flex items-start gap-2 font-label-mono text-[12px] uppercase text-on-surface-variant">
          <input type="checkbox" id="zone-exempt" ${z?.taxExempt ? "checked" : ""}/>
          <span>Exportación: productos físicos sin IVA<br/><span class="normal-case">Solo para destinos fuera de la UE. Las entradas siguen llevando IVA.</span></span>
        </label>
        ${fText("sortOrder", "Orden", z?.sortOrder ?? 0, { type: "number", min: 0 })}
        <div id="zone-countries-wrap" class="${z?.restOfWorld ? "hidden" : ""}">
          <label class="nt-label">Países</label>
          <div class="flex gap-2 my-2">
            <button type="button" id="zone-eu" class="font-label-mono text-[11px] uppercase border border-outline-variant/30 px-2 py-1 text-on-surface-variant hover:border-secondary hover:text-secondary">+ UE-27</button>
            <input id="zone-filter" class="nt-input !py-1" placeholder="Filtrar países"/>
          </div>
          <div id="zone-countries" class="max-h-64 overflow-y-auto border border-outline-variant/20 p-2 grid grid-cols-2 gap-1">
            ${ntCountryOptions().map(([code, name]) => `
              <label class="flex items-center gap-2 text-[13px] text-on-surface-variant" data-country-label="${ntEscapeHtml(name.toLowerCase())}">
                <input type="checkbox" value="${code}" ${selected.has(code) ? "checked" : ""}/> ${ntEscapeHtml(name)}
              </label>`).join("")}
          </div>
        </div>`;
      Drawer.open(z ? "Editar zona" : "Nueva zona", html, () => {
        const v = drawerValues();
        const restOfWorld = document.getElementById("zone-row").checked;
        const countries = restOfWorld ? [] : [...document.querySelectorAll("#zone-countries input:checked")].map((i) => i.value);
        if (!restOfWorld && !countries.length) { ntToast("Elige al menos un país (o marca resto del mundo)", true); return; }
        const payload = {
          name: v.name,
          restOfWorld,
          countries,
          taxExempt: document.getElementById("zone-exempt").checked,
          sortOrder: parseInt(v.sortOrder || "0", 10),
        };
        return submitAndReload(
          z ? adminApi(`/admin/shipping/zones/${z.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/shipping/zones", { method: "POST", body: JSON.stringify(payload) }),
          "shipping", z ? "Zona actualizada" : "Zona creada");
      });
      document.getElementById("zone-row").addEventListener("change", (e) =>
        document.getElementById("zone-countries-wrap").classList.toggle("hidden", e.target.checked));
      document.getElementById("zone-eu").addEventListener("click", () =>
        document.querySelectorAll("#zone-countries input").forEach((i) => { if (EU.includes(i.value)) i.checked = true; }));
      document.getElementById("zone-filter").addEventListener("input", (e) => {
        const q = e.target.value.trim().toLowerCase();
        document.querySelectorAll("[data-country-label]").forEach((l) =>
          l.classList.toggle("hidden", !!q && !l.dataset.countryLabel.includes(q)));
      });
    },
  },

  // ---------------- CUPONES ----------------
  discounts: {
    title: "Cupones",
    icon: "sell",
    adminOnly: true,
    items: [],
    async load() {
      actionsHost().innerHTML = newButton();
      document.getElementById("btn-new").addEventListener("click", () => this.form());
      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const { discounts } = await adminApi("/admin/discounts");
      this.items = discounts;
      const typeLabel = { PORCENTAJE: "%", MONTO_FIJO: "€ fijo", ENVIO_GRATIS: "Envío gratis" };
      const rows = discounts.map((d) => `
        <tr>
          <td class="font-label-mono font-bold text-secondary">${ntEscapeHtml(d.code)}</td>
          <td>${typeLabel[d.type] || d.type}</td>
          <td>${d.type === "ENVIO_GRATIS" ? "—" : d.type === "PORCENTAJE" ? `${Number(d.value)}%` : ntFormatMoney(d.value)}</td>
          <td class="font-label-mono text-[12px] whitespace-nowrap">${fmtShortDate(d.startDate)}<br/>${fmtShortDate(d.endDate)}</td>
          <td class="font-label-mono text-[12px]">${d.currentUses}${d.maxUses ? ` / ${d.maxUses}` : ""}</td>
          <td>${statusBadge(d.status)}</td>
          ${rowActions(d.id)}
        </tr>`);
      host().innerHTML = renderTable(["Código", "Tipo", "Valor", "Vigencia", "Usos", "Estado", ""], rows, "Sin cupones.");
      wireRowActions(this.items, (d) => this.form(d), (d) =>
        submitAndReload(adminApi(`/admin/discounts/${d.id}`, { method: "DELETE" }), "discounts", "Cupón eliminado"));
    },
    form(d = null) {
      const html = `
        ${fText("code", "Código", d?.code, { required: !d, placeholder: "NOCHE20", disabled: !!d })}
        ${d ? `<p class="font-label-mono text-[11px] text-on-surface-variant uppercase -mt-3">El código no se puede cambiar una vez creado</p>` : ""}
        ${fSelect("type", "Tipo", [["PORCENTAJE", "Porcentaje"], ["MONTO_FIJO", "Monto fijo (EUR)"], ["ENVIO_GRATIS", "Envío gratis"]], d?.type || "PORCENTAJE")}
        ${fText("value", "Valor (ignorado si es envío gratis)", d?.value ?? "", { type: "number", step: "0.01", min: 0 })}
        ${fDatetime("startDate", "Inicio", d?.startDate, true)}
        ${fDatetime("endDate", "Fin", d?.endDate, true)}
        ${fText("maxUses", "Usos máximos (vacío = ilimitado)", d?.maxUses ?? "", { type: "number", min: 1 })}
        ${fText("minPurchaseAmount", "Compra mínima (EUR)", d?.minPurchaseAmount ?? 0, { type: "number", step: "0.01", min: 0 })}
        ${fSelect("status", "Estado", ["ACTIVO", "INACTIVO"], d?.status || "ACTIVO")}`;
      Drawer.open(d ? `Editar ${d.code}` : "Nuevo cupón", html, () => {
        const v = drawerValues();
        const payload = clean({
          type: v.type,
          value: parseFloat(v.value || "0"),
          startDate: fromLocalInput(v.startDate),
          endDate: fromLocalInput(v.endDate),
          maxUses: v.maxUses ? parseInt(v.maxUses, 10) : undefined,
          minPurchaseAmount: parseFloat(v.minPurchaseAmount || "0"),
          status: v.status,
        });
        if (!d) payload.code = v.code;
        return submitAndReload(
          d ? adminApi(`/admin/discounts/${d.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/discounts", { method: "POST", body: JSON.stringify(payload) }),
          "discounts", d ? "Cupón actualizado" : "Cupón creado");
      });
    },
  },

  // ---------------- BOOKINGS ----------------
  bookings: {
    title: "Bookings",
    icon: "mail",
    filter: "",
    items: [],
    async load() {
      const STATUSES = ["NUEVA", "EN_REVISION", "ACEPTADA", "RECHAZADA"];
      actionsHost().innerHTML = `
        <select id="booking-filter" class="nt-input !w-auto font-label-mono text-[13px] uppercase">
          <option value="">Todas</option>
          ${STATUSES.map((s) => `<option value="${s}" ${this.filter === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>`;
      document.getElementById("booking-filter").addEventListener("change", (e) => {
        this.filter = e.target.value;
        this.load();
      });
      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const { bookings } = await adminApi(`/admin/bookings${this.filter ? `?status=${this.filter}` : ""}`);
      this.items = bookings;
      const rows = bookings.map((b) => `
        <tr>
          <td>${badge(b.type === "CONTRATACION" ? "Booking" : "Collab", b.type === "CONTRATACION" ? "ok" : "muted")}</td>
          <td class="font-bold">${ntEscapeHtml(b.requesterName)}</td>
          <td class="font-label-mono text-[12px]">${ntEscapeHtml(b.email)}</td>
          <td class="font-label-mono text-[12px] whitespace-nowrap">${fmtShortDate(b.createdAt)}</td>
          <td class="max-w-[340px]">
            <details>
              <summary class="cursor-pointer font-label-mono text-[12px] text-secondary uppercase">Ver detalles</summary>
              <p class="text-on-surface-variant whitespace-pre-line mt-2 text-[13px]">${ntEscapeHtml(b.details)}</p>
            </details>
          </td>
          <td>
            <select class="nt-input !w-auto font-label-mono text-[12px] uppercase" data-booking-status="${b.id}">
              ${STATUSES.map((s) => `<option value="${s}" ${b.status === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </td>
        </tr>`);
      host().innerHTML = renderTable(["Tipo", "Solicitante", "Email", "Fecha", "Detalles", "Estado"], rows, "Bandeja vacía.");
      host().querySelectorAll("[data-booking-status]").forEach((sel) =>
        sel.addEventListener("change", async () => {
          try {
            await adminApi(`/admin/bookings/${sel.dataset.bookingStatus}/status`, {
              method: "PUT",
              body: JSON.stringify({ status: sel.value }),
            });
            ntToast(`Booking -> ${sel.value}`);
          } catch (err) {
            ntToast(err.message, true);
            this.load();
          }
        }));
    },
  },

  // ---------------- NEWSLETTER ----------------
  newsletter: {
    title: "Newsletter",
    icon: "alternate_email",
    adminOnly: true,
    page: 1,
    statusFilter: "ACTIVO",
    async load() {
      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const params = new URLSearchParams({ page: this.page, pageSize: 50 });
      if (this.statusFilter) params.set("status", this.statusFilter);
      const { subscribers, stats, pagination } = await adminApi(`/admin/newsletter?${params}`);

      actionsHost().innerHTML = `
        <span class="font-label-mono text-[12px] text-secondary uppercase">${stats.active} activos</span>
        <select id="nl-status" class="nt-input !w-auto font-label-mono text-[12px] uppercase">
          ${[["ACTIVO", "Activos"], ["BAJA", "Bajas"], ["", "Todos"]].map(([v, l]) => `<option value="${v}" ${this.statusFilter === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <span class="font-label-mono text-[12px] text-on-surface-variant uppercase">${pagination.page} / ${Math.max(pagination.totalPages, 1)}</span>
        <button id="nl-prev" class="adm-icon-btn" ${pagination.page <= 1 ? "disabled" : ""}><span class="material-symbols-outlined">chevron_left</span></button>
        <button id="nl-next" class="adm-icon-btn" ${pagination.page >= pagination.totalPages ? "disabled" : ""}><span class="material-symbols-outlined">chevron_right</span></button>
        <button id="nl-export" class="bg-secondary-container text-primary-container font-headline-lg text-[18px] uppercase px-5 py-2 hover:bg-on-surface transition-colors">Exportar CSV</button>`;
      document.getElementById("nl-status").addEventListener("change", (e) => { this.statusFilter = e.target.value; this.page = 1; this.load(); });
      document.getElementById("nl-prev").addEventListener("click", () => { this.page--; this.load(); });
      document.getElementById("nl-next").addEventListener("click", () => { this.page++; this.load(); });
      document.getElementById("nl-export").addEventListener("click", () => this.exportCsv());

      const rows = subscribers.map((sub) => `
        <tr>
          <td class="font-label-mono text-[12px]">${ntEscapeHtml(sub.email)}</td>
          <td>${statusBadge(sub.status)}</td>
          <td class="font-label-mono text-[12px] text-on-surface-variant">${ntEscapeHtml(sub.source)}</td>
          <td class="font-label-mono text-[12px] whitespace-nowrap">${fmtShortDate(sub.consentAt)}</td>
          <td class="font-label-mono text-[12px] whitespace-nowrap text-on-surface-variant">${sub.unsubscribedAt ? fmtShortDate(sub.unsubscribedAt) : "—"}</td>
        </tr>`);
      host().innerHTML = renderTable(["Email", "Estado", "Origen", "Consentimiento", "Baja"], rows, "Sin suscriptores.");
    },
    // El export necesita el Authorization header, así que no vale un <a href>:
    // se descarga como blob y se ofrece como archivo.
    async exportCsv() {
      try {
        const res = await fetch("/api/admin/newsletter/export", { headers: { Authorization: `Bearer ${Auth.token}` } });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error((body && body.error) || `Error ${res.status}`);
        }
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = `newsletter-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        ntToast(err.message, true);
      }
    },
  },

  // ---------------- LOGS ----------------
  logs: {
    title: "Auditoría",
    icon: "receipt_long",
    page: 1,
    async load() {
      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const { logs, pagination } = await adminApi(`/admin/logs?page=${this.page}&pageSize=50`);
      actionsHost().innerHTML = `
        <span class="font-label-mono text-[12px] text-on-surface-variant uppercase">Página ${pagination.page} / ${Math.max(pagination.totalPages, 1)}</span>
        <button id="logs-prev" class="adm-icon-btn" ${pagination.page <= 1 ? "disabled" : ""}><span class="material-symbols-outlined">chevron_left</span></button>
        <button id="logs-next" class="adm-icon-btn" ${pagination.page >= pagination.totalPages ? "disabled" : ""}><span class="material-symbols-outlined">chevron_right</span></button>`;
      document.getElementById("logs-prev").addEventListener("click", () => { this.page--; this.load(); });
      document.getElementById("logs-next").addEventListener("click", () => { this.page++; this.load(); });
      const rows = logs.map((l) => `
        <tr>
          <td class="font-label-mono text-[12px] whitespace-nowrap">${fmtShortDate(l.createdAt)}</td>
          <td class="font-label-mono text-[12px]">${ntEscapeHtml(l.user.name)}<br/><span class="text-on-surface-variant">${l.user.role}</span></td>
          <td>${ntEscapeHtml(l.action)}</td>
          <td class="font-label-mono text-[12px] text-on-surface-variant">${ntEscapeHtml(l.ip || "—")}</td>
        </tr>`);
      host().innerHTML = renderTable(["Fecha", "Usuario", "Acción", "IP"], rows, "Sin actividad registrada.");
    },
  },
};

// ============================================================
// Router + arranque
// ============================================================

let currentSection = null;

function renderNav() {
  const nav = document.getElementById("admin-nav");
  const user = Auth.user;
  nav.innerHTML = Object.entries(Sections)
    .filter(([, s]) => !s.adminOnly || (user && user.role === "ADMIN"))
    .map(([id, s]) => `
      <button class="adm-nav-btn ${id === currentSection ? "active" : ""}" data-section="${id}">
        <span class="material-symbols-outlined text-[16px] align-middle mr-2">${s.icon}</span>${s.title}
      </button>`)
    .join("");
  nav.querySelectorAll("[data-section]").forEach((btn) =>
    btn.addEventListener("click", () => (window.location.hash = btn.dataset.section)));
}

async function showSection(id) {
  // Libera recursos de la sección anterior (p. ej. la cámara del check-in).
  Object.values(Sections).forEach((s) => s.unload && s.unload());
  const section = Sections[id] || Sections.products;
  currentSection = Sections[id] ? id : "products";
  renderNav();
  document.getElementById("section-title").textContent = section.title;
  actionsHost().innerHTML = "";
  try {
    await section.load();
  } catch (err) {
    if (err.status !== 401) {
      host().innerHTML = `<div class="border border-error/40 p-stack-lg text-center">
        <p class="font-label-mono text-label-mono text-error uppercase">${ntEscapeHtml(err.message)}</p>
      </div>`;
    }
  }
}

function showLogin(message = "") {
  document.getElementById("panel-view").classList.add("hidden");
  document.getElementById("login-view").classList.remove("hidden");
  const errEl = document.getElementById("login-error");
  errEl.textContent = message;
  errEl.classList.toggle("hidden", !message);
}

function showPanel() {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("panel-view").classList.remove("hidden");
  const user = Auth.user;
  document.getElementById("user-chip").textContent = user ? `${user.name} — ${user.role}` : "";
  showSection(window.location.hash.slice(1) || "products");
}

document.addEventListener("DOMContentLoaded", () => {
  // Login
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const { token, user } = await ntApi("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("login-email").value.trim(),
          password: document.getElementById("login-password").value,
        }),
      });
      if (user.role !== "ADMIN" && user.role !== "STAFF") {
        showLogin("Tu usuario no tiene acceso al panel.");
        return;
      }
      Auth.save(token, user);
      showPanel();
    } catch (err) {
      showLogin(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // Logout: revoca el token en el servidor (denylist) y luego limpia el cliente.
  document.getElementById("logout-btn").addEventListener("click", async () => {
    try {
      await adminApi("/auth/logout", { method: "POST" });
    } catch {
      /* aunque falle la revocación, limpiamos la sesión local igualmente */
    }
    Auth.clear();
    showLogin();
  });

  // Drawer
  document.getElementById("drawer-close").addEventListener("click", () => Drawer.close());
  document.getElementById("drawer-backdrop").addEventListener("click", () => Drawer.close());
  document.getElementById("drawer-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!e.target.reportValidity()) return;
    if (Drawer.onSubmit) Drawer.onSubmit();
  });

  // Navegación por hash
  window.addEventListener("hashchange", () => {
    if (Auth.token) showSection(window.location.hash.slice(1) || "products");
  });

  // Arranque: si hay token intentamos entrar directamente; /auth/me valida que siga vivo.
  if (Auth.token) {
    adminApi("/auth/me")
      .then(() => showPanel())
      .catch(() => {}); // adminApi ya redirige al login en 401
  } else {
    showLogin();
  }
});
