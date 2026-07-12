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
  badge(status, { ACTIVO: "ok", PUBLICADO: "ok", ABIERTO: "ok", ACEPTADA: "ok", PAGADO: "ok",
    AGOTADO: "warn", CANCELADO: "warn", RECHAZADA: "warn", FALLIDO: "warn" }[status] || "muted");

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

// ============================================================
// SECCIONES
// ============================================================

const SIZES = ["S", "M", "L", "XL"];

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
      const { products } = await adminApi("/admin/products");
      this.items = products;
      const rows = products.map((p) => `
        <tr>
          <td class="font-bold uppercase">${ntEscapeHtml(p.name)}</td>
          <td>${ntFormatMoney(p.price)}</td>
          <td>${badge(p.productType === "DROP_EXCLUSIVO" ? "DROP" : "TIENDA", p.productType === "DROP_EXCLUSIVO" ? "ok" : "muted")}</td>
          <td>${statusBadge(p.status)}</td>
          <td class="font-label-mono text-[12px]">${p.variants.map((v) => `${v.size}:${v.stockAvailable}`).join(" · ") || "—"}</td>
          <td>${p.dropMeta ? `${badge(p.dropMeta.dropStatus, p.dropMeta.dropStatus === "ABIERTO" ? "ok" : "muted")}<br/><span class="font-label-mono text-[11px] text-on-surface-variant">${fmtShortDate(p.dropMeta.releaseAt)}</span>` : "—"}</td>
          ${rowActions(p.id)}
        </tr>`);
      host().innerHTML = renderTable(
        ["Nombre", "Precio", "Tipo", "Estado", "Stock por talla", "Drop", ""],
        rows, "Sin productos. Crea el primero.");
      wireRowActions(this.items, (p) => this.form(p), (p) =>
        submitAndReload(adminApi(`/admin/products/${p.id}`, { method: "DELETE" }), "products", "Producto eliminado"));
    },
    form(p = null) {
      const stockOf = (size) => {
        const v = p && p.variants.find((x) => x.size === size);
        return v ? v.stockAvailable : "";
      };
      const html = `
        ${fText("name", "Nombre", p?.name, { required: true })}
        ${fTextarea("description", "Descripción", p?.description)}
        ${fText("price", "Precio (EUR)", p?.price, { type: "number", step: "0.01", min: 0, required: true })}
        ${fTextarea("images", "Imágenes (una URL por línea)", (p?.images || []).join("\n"), 2)}
        ${fSelect("productType", "Tipo", [["TIENDA_GENERAL", "Tienda general"], ["DROP_EXCLUSIVO", "Drop exclusivo"]], p?.productType || "TIENDA_GENERAL")}
        ${fSelect("status", "Estado", ["BORRADOR", "ACTIVO", "AGOTADO"], p?.status || "BORRADOR")}
        <div>
          <label class="nt-label">Stock por talla ${p ? "(se actualizan/añaden las tallas indicadas)" : "(mínimo una)"}</label>
          <div class="grid grid-cols-4 gap-3 mt-2">
            ${SIZES.map((s) => `
              <div class="border border-outline-variant/30 p-2 text-center">
                <span class="font-label-mono text-[12px] text-secondary uppercase block mb-1">${s}</span>
                <input class="nt-input text-center" name="stock-${s}" type="number" min="0" value="${stockOf(s)}" placeholder="—"/>
              </div>`).join("")}
          </div>
        </div>
        <fieldset id="drop-fields" class="border border-secondary-container/40 p-4 space-y-4 ${(p?.productType || "TIENDA_GENERAL") === "DROP_EXCLUSIVO" ? "" : "hidden"}">
          <legend class="font-label-mono text-[12px] text-secondary uppercase px-2">Metadatos del drop</legend>
          ${fDatetime("releaseAt", "Fecha/hora de lanzamiento", p?.dropMeta?.releaseAt)}
          ${fSelect("dropStatus", "Estado del drop", ["PROXIMAMENTE", "ABIERTO", "FINALIZADO"], p?.dropMeta?.dropStatus || "PROXIMAMENTE")}
        </fieldset>`;

      Drawer.open(p ? "Editar producto" : "Nuevo producto", html, () => {
        const v = drawerValues();
        const variants = SIZES
          .filter((s) => v[`stock-${s}`] !== "")
          .map((s) => ({ size: s, stockAvailable: parseInt(v[`stock-${s}`], 10) }));
        const payload = clean({
          name: v.name,
          description: v.description,
          price: parseFloat(v.price),
          productType: v.productType,
          status: v.status,
        });
        payload.images = v.images ? v.images.split("\n").map((l) => l.trim()).filter(Boolean) : [];
        if (variants.length) payload.variants = variants;
        if (v.productType === "DROP_EXCLUSIVO" && v.releaseAt) {
          payload.dropMeta = { releaseAt: fromLocalInput(v.releaseAt), dropStatus: v.dropStatus };
        }
        return submitAndReload(
          p ? adminApi(`/admin/products/${p.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/products", { method: "POST", body: JSON.stringify(payload) }),
          "products", p ? "Producto actualizado" : "Producto creado");
      });

      document.getElementById("drawer-form")
        .querySelector("[name=productType]")
        .addEventListener("change", (e) =>
          document.getElementById("drop-fields").classList.toggle("hidden", e.target.value !== "DROP_EXCLUSIVO"));
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
        ${fTextarea("images", "Fotos (una URL por línea)", (a?.images || []).join("\n"), 2)}
        ${fSelect("status", "Estado", ["ACTIVO", "INACTIVO"], a?.status || "ACTIVO")}`;
      Drawer.open(a ? "Editar artista" : "Nuevo artista", html, () => {
        const v = drawerValues();
        const payload = clean({
          stageName: v.stageName, bio: v.bio, spotifyId: v.spotifyId, youtube: v.youtube,
          soundcloudId: v.soundcloudId, instagram: v.instagram, status: v.status,
        });
        payload.images = v.images ? v.images.split("\n").map((l) => l.trim()).filter(Boolean) : [];
        return submitAndReload(
          a ? adminApi(`/admin/artists/${a.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/artists", { method: "POST", body: JSON.stringify(payload) }),
          "artists", a ? "Artista actualizado" : "Artista creado");
      });
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
        ${fText("posterUrl", "Póster (URL)", e?.posterUrl)}
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
          posterUrl: v.posterUrl,
          price: parseFloat(v.price || "0"),
          status: v.status,
        });
        payload.lineup = lineup;
        return submitAndReload(
          e ? adminApi(`/admin/events/${e.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/events", { method: "POST", body: JSON.stringify(payload) }),
          "events", e ? "Evento actualizado" : "Evento creado");
      });

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

  // ---------------- PEDIDOS ----------------
  orders: {
    title: "Pedidos",
    icon: "package_2",
    page: 1,
    statusFilter: "",
    fulfillmentFilter: "",
    items: [],
    async load() {
      const PAY_STATUSES = ["PENDIENTE", "PAGADO", "FALLIDO", "CANCELADO"];
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
                <p class="font-bold text-on-surface">${(o.items || []).map((i) => `${i.quantity}x ${ntEscapeHtml(i.product.name)} (${i.productVariant.size})`).join("<br/>")}</p>
                <p>${ntEscapeHtml(o.shippingName || "")}<br/>${ntEscapeHtml(o.shippingAddress || "")}<br/>${ntEscapeHtml([o.shippingPostalCode, o.shippingCity, o.shippingCountry].filter(Boolean).join(", "))}${o.shippingPhone ? `<br/>Tel: ${ntEscapeHtml(o.shippingPhone)}` : ""}</p>
                ${o.discountCode ? `<p>Cupón: <span class="text-secondary">${ntEscapeHtml(o.discountCode.code)}</span></p>` : ""}
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
        </tr>`);
      host().innerHTML = renderTable(
        ["Fecha", "Email", "Total", "Pago", "Método envío", "Detalle", "Estado envío"],
        rows, "Sin pedidos todavía.");

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
  },

  // ---------------- ENVÍOS ----------------
  shipping: {
    title: "Envíos",
    icon: "local_shipping",
    items: [],
    async load() {
      actionsHost().innerHTML = newButton();
      document.getElementById("btn-new").addEventListener("click", () => this.form());
      host().innerHTML = `<div class="nt-skeleton h-40"></div>`;
      const { methods } = await adminApi("/admin/shipping");
      this.items = methods;
      const rows = methods.map((m) => `
        <tr>
          <td class="font-bold uppercase">${ntEscapeHtml(m.name)}</td>
          <td class="text-on-surface-variant">${ntEscapeHtml(m.description || "—")}</td>
          <td class="font-label-mono">${Number(m.price) === 0 ? "Gratis" : ntFormatMoney(m.price)}</td>
          <td>${badge(m.active ? "ACTIVO" : "INACTIVO", m.active ? "ok" : "muted")}</td>
          <td class="font-label-mono text-[12px]">${m.sortOrder}</td>
          ${rowActions(m.id)}
        </tr>`);
      host().innerHTML = renderTable(["Nombre", "Descripción", "Coste", "Estado", "Orden", ""], rows,
        "Sin métodos de envío. Crea el primero para habilitar el checkout con envío.");
      wireRowActions(this.items, (m) => this.form(m), (m) =>
        submitAndReload(adminApi(`/admin/shipping/${m.id}`, { method: "DELETE" }), "shipping", "Método eliminado"));
    },
    form(m = null) {
      const html = `
        ${fText("name", "Nombre", m?.name, { required: true, placeholder: "Estándar 48/72h" })}
        ${fText("description", "Descripción", m?.description, { placeholder: "Península. Entrega en 2-3 días laborables" })}
        ${fText("price", "Coste (EUR)", m?.price ?? "", { type: "number", step: "0.01", min: 0, required: true })}
        ${fSelect("active", "Visible en el checkout", [["true", "Sí"], ["false", "No"]], String(m?.active ?? true))}
        ${fText("sortOrder", "Orden (menor = primero)", m?.sortOrder ?? 0, { type: "number", min: 0 })}`;
      Drawer.open(m ? "Editar método de envío" : "Nuevo método de envío", html, () => {
        const v = drawerValues();
        const payload = clean({
          name: v.name,
          description: v.description,
          price: parseFloat(v.price),
          sortOrder: parseInt(v.sortOrder || "0", 10),
        });
        payload.active = v.active === "true";
        return submitAndReload(
          m ? adminApi(`/admin/shipping/${m.id}`, { method: "PUT", body: JSON.stringify(payload) })
            : adminApi("/admin/shipping", { method: "POST", body: JSON.stringify(payload) }),
          "shipping", m ? "Método actualizado" : "Método creado");
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

  // Logout
  document.getElementById("logout-btn").addEventListener("click", () => {
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
