// ============================================================
// NOT TODAY — capa de rediseño: accesibilidad y movimiento.
// Lo que el HTML no trae de serie:
// salto al contenido, iconos decorativos ocultos al lector, nombres
// en botones de solo icono, toast anunciado, etiquetas en tipo de
// frase en vez de MAYÚSCULAS, y entrada escalonada por sección.
// ============================================================
(function () {
  const KEEP = /^(NOT|TODAY|NT|N-TY|NTY|DJ|DJS|MC|IVA|EP|LP|FM|ES|EU|UE|URL|ID|QR|PDF|CSV|SEO|API|RSVP|VIP|B2B|XL|XXL|XS|S|M|L|EUR|€|\d+.*)$/;
  const ICON_NAMES = {
    close: "Cerrar", menu: "Abrir menú", shopping_bag: "Carrito", shopping_cart: "Carrito", search: "Buscar",
    arrow_back: "Atrás", arrow_forward: "Siguiente", chevron_left: "Anterior", chevron_right: "Siguiente",
    add: "Añadir", remove: "Quitar", delete: "Eliminar", edit: "Editar", play_arrow: "Reproducir", pause: "Pausar",
    share: "Compartir", logout: "Cerrar sesión", expand_more: "Mostrar más", volume_up: "Sonido", volume_off: "Silenciar",
  };

  function sentence(text) {
    const words = text.split(/(\s+)/);
    let first = true;
    return words.map((w) => {
      if (!/\S/.test(w)) return w;
      const bare = w.replace(/[^\p{L}\p{N}€-]/gu, "");
      if (KEEP.test(bare)) { first = false; return w; }
      const low = w.toLocaleLowerCase("es");
      if (first && /\p{L}/u.test(low)) { first = false; return low.replace(/\p{L}/u, (c) => c.toLocaleUpperCase("es")); }
      return low;
    }).join("");
  }
  const LABELISH = ".font-label-mono, .text-label-mono, button, .btn-primary, .btn-secondary, nav a, footer a, label, th";
  function fixCase(root) {
    const scope = root.nodeType === 1 ? root : root.parentElement;
    if (!scope) return;
    const els = scope.matches && scope.matches(LABELISH) ? [scope, ...scope.querySelectorAll(LABELISH)] : scope.querySelectorAll(LABELISH);
    els.forEach((el) => {
      if (el.closest("h1,h2,h3,.material-symbols-outlined,[class*='font-headline'],[class*='font-display'],script,style,code")) return;
      el.childNodes.forEach((n) => {
        if (n.nodeType !== 3) return;
        const t = n.nodeValue;
        if (t.replace(/[^\p{L}]/gu, "").length < 3 || t !== t.toLocaleUpperCase("es")) return;
        n.nodeValue = sentence(t).replace(/\.\.\./g, "…");
      });
    });
  }

  function a11y(root) {
    const scope = root.querySelectorAll ? root : document;
    scope.querySelectorAll(".material-symbols-outlined, .material-icons").forEach((i) => i.setAttribute("aria-hidden", "true"));
    scope.querySelectorAll("button, a[href]").forEach((b) => {
      if (b.getAttribute("aria-label") || b.textContent.replace(/\s/g, "").length === 0 && b.querySelector("img[alt]")) return;
      const icon = b.querySelector(".material-symbols-outlined, .material-icons");
      const visible = [...b.childNodes].filter((n) => !(n.nodeType === 1 && n.matches(".material-symbols-outlined, .material-icons"))).map((n) => n.textContent).join("").trim();
      if (icon && !visible) b.setAttribute("aria-label", b.title || ICON_NAMES[icon.textContent.trim()] || icon.textContent.trim().replace(/_/g, " "));
    });
    scope.querySelectorAll("img:not([loading])").forEach((img) => { if (!img.closest("header,nav,#hero,[data-hero]")) img.loading = "lazy"; img.decoding = "async"; });
    scope.querySelectorAll('input[type="email"]:not([autocomplete])').forEach((i) => (i.autocomplete = "email"));
    scope.querySelectorAll('input[type="email"]').forEach((i) => (i.spellcheck = false));
    scope.querySelectorAll('input[type="tel"]:not([autocomplete])').forEach((i) => (i.autocomplete = "tel"));
    scope.querySelectorAll("input[placeholder], textarea[placeholder]").forEach((i) => { if (/\.\.\.$/.test(i.placeholder)) i.placeholder = i.placeholder.replace(/\.\.\.$/, "…"); });
    const toast = document.getElementById("nt-toast");
    if (toast && !toast.hasAttribute("aria-live")) { toast.setAttribute("role", "status"); toast.setAttribute("aria-live", "polite"); }
  }

  // Entrada escalonada: título, texto y luego imagen de cada sección
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let io = null;
  function rise(root) {
    if (reduce || !("IntersectionObserver" in window)) return;
    io = io || new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add("nt-rise");
      e.target.classList.remove("nt-will-rise");
      io.unobserve(e.target);
    }), { rootMargin: "0px 0px -8% 0px" });
    (root.querySelectorAll ? root : document).querySelectorAll("main section, body > section").forEach((sec) => {
      if (sec.dataset.ntRise) return;
      sec.dataset.ntRise = "1";
      const r = sec.getBoundingClientRect();
      if (r.top < innerHeight * 0.9) return; // lo que ya se ve, se queda quieto
      const parts = sec.querySelectorAll(":scope h2, :scope h3, :scope p, :scope img, :scope article, :scope a[class*='bg-'], :scope button");
      [...parts].slice(0, 14).forEach((el, i) => {
        el.style.setProperty("--nt-delay", Math.min(i, 8) * 70 + "ms");
        el.classList.add("nt-will-rise");
        io.observe(el);
      });
    });
  }

  function run(root) { fixCase(root); a11y(root); }

  document.addEventListener("DOMContentLoaded", () => {
    const main = document.querySelector("main") || document.querySelector("section");
    if (main && !main.id) main.id = "contenido";
    if (main) {
      const s = document.createElement("a");
      s.className = "nt-skip"; s.href = "#" + main.id; s.textContent = "Saltar al contenido";
      document.body.prepend(s);
    }
    const radial = [...document.querySelectorAll("[style*='radial-gradient']")];
    radial.forEach((el) => el.setAttribute("data-nt-decor", "radial"));
    run(document.body);
    setTimeout(() => rise(document), 400);
    let pending = new Set();
    new MutationObserver((muts) => {
      muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) pending.add(n); else if (n.nodeType === 3 && n.parentElement) pending.add(n.parentElement); }));
      if (pending.size === 1 && pending.values().next().value === null) return;
      requestAnimationFrame(() => { const list = [...pending]; pending = new Set(); list.forEach((n) => n.isConnected && run(n)); });
    }).observe(document.body, { childList: true, subtree: true, characterData: false });
  });
})();
