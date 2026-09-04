// ============================================================
// NOT TODAY — nav + footer + bottom nav compartidos (todas las páginas)
//
// Sustituye a los layouts de nav/footer/bottom-nav que antes se repetían
// (y divergían) copiados en cada página. Cada página llama a
// NTChrome.mount({ active, showFooter }) justo después de cargar este script
// y ANTES de cart.js, para que el botón del carrito exista en el DOM cuando
// cart.js lo busque (mismo patrón que cart.js: querySelectorAll en mount()).
// ============================================================

const NTChrome = (() => {
  const LAB_ITEMS = [
    { label: "N-TY SESSION", href: "sessions.html" },
    { label: "N-TY RADIO", href: "radio.html" },
  ];
  const SHOP_ITEMS = [
    { label: "N-TY CLOTHES", href: "store.html" },
    { label: "TICKETS", href: "tickets.html" },
  ];
  const CONTACT_ITEMS = [
    { label: "BOOK AN ARTIST", href: "booking.html" },
    { label: "SOBRE NOSOTROS", href: "about.html" },
    { label: "SERVICIOS", href: "services.html" },
  ];
  const LAB_VIEWS = ["sessions", "radio"];
  const SHOP_VIEWS = ["store", "tickets"];
  const CONTACT_VIEWS = ["booking", "about", "services"];

  function activeGroup(active) {
    if (SHOP_VIEWS.includes(active)) return "shop";
    if (LAB_VIEWS.includes(active)) return "lab";
    if (CONTACT_VIEWS.includes(active)) return "contacto";
    if (active === "newsletter") return "news";
    return null;
  }

  function navItemHtml(group, label, opts) {
    const isActive = opts.activeGroup === group;
    const color = isActive ? "text-secondary" : "text-on-surface-variant";
    if (opts.children) {
      return `
        <div class="nt-nav-item relative" data-nav-group="${group}">
          <a href="${opts.href}" class="flex items-center gap-1.5 px-4 py-2.5 font-label-mono text-[11px] tracking-[0.14em] uppercase ${color} hover:text-secondary transition-colors">
            ${label}<span class="material-symbols-outlined text-[14px] opacity-60">expand_more</span>
          </a>
          <div class="nt-nav-sub hidden min-w-[190px] bg-[rgba(9,9,9,0.96)] border border-[#2a2a2a] backdrop-blur-md">
            ${opts.children
              .map(
                (c) =>
                  `<a href="${c.href}" class="block px-[18px] py-[13px] font-label-mono text-[10px] tracking-[0.12em] uppercase text-on-surface-variant border-b border-[#20201f] last:border-b-0 hover:text-secondary hover:bg-[#161615] transition-colors whitespace-nowrap">${c.label}</a>`
              )
              .join("")}
          </div>
        </div>`;
    }
    return `<a href="${opts.href}" class="px-4 py-2.5 font-label-mono text-[11px] tracking-[0.14em] uppercase ${color} hover:text-secondary transition-colors">${label}</a>`;
  }

  function navHtml(active) {
    const ag = activeGroup(active);
    const items = [
      navItemHtml("lab", "LAB", { activeGroup: ag, href: "sessions.html", children: LAB_ITEMS }),
      navItemHtml("shop", "SHOP", { activeGroup: ag, href: "store.html", children: SHOP_ITEMS }),
      navItemHtml("news", "NEWSLETTER", { activeGroup: ag, href: "newsletter.html" }),
      navItemHtml("contacto", "CONTACTO", { activeGroup: ag, href: "booking.html", children: CONTACT_ITEMS }),
    ].join("");

    return `
    <div id="nt-nav-wrap" style="position:fixed;left:0;right:0;z-index:600;display:flex;justify-content:center;pointer-events:none;">
      <nav id="nt-nav-bar" style="pointer-events:auto;display:flex;align-items:center;gap:14px;background:rgba(9,9,9,0.85);border:1px solid #2a2a2a;border-bottom:1px solid #3c3c3c;backdrop-filter:blur(14px);box-shadow:0 18px 50px rgba(0,0,0,0.45);transform:translateY(220%);opacity:0;transition:transform 1.15s cubic-bezier(.16,1,.3,1), opacity .9s ease, background .4s ease;">
        <a href="index.html" class="font-label-mono font-bold text-[16px] tracking-[0.06em] uppercase text-on-surface whitespace-nowrap" style="text-decoration:none;">NOT TODAY</a>
        <div class="hidden md:block" style="width:1px;height:20px;background:#444748;"></div>
        <div id="nt-nav-items" class="hidden md:flex items-stretch">${items}</div>
        <button data-cart-toggle aria-label="Abrir carrito" class="relative flex items-center justify-center p-1.5 text-on-surface hover:text-secondary transition-colors">
          <span class="material-symbols-outlined text-[20px]">shopping_bag</span>
          <span data-cart-count class="hidden absolute -top-0.5 -right-0.5 bg-secondary-container text-primary-container font-label-mono text-[10px] w-4 h-4 items-center justify-center">0</span>
        </button>
      </nav>
    </div>`;
  }

  function footerHtml() {
    return `
    <footer class="border-t border-outline-variant/30 px-margin-mobile md:px-margin-desktop py-stack-lg pb-24 md:pb-stack-lg grid grid-cols-1 md:grid-cols-4 gap-gutter">
      <div>
        <div class="font-headline-lg text-[20px] text-on-surface mb-2">NOT TODAY</div>
        <div class="font-label-mono text-[11px] text-on-surface-variant">@nottoday.nty</div>
      </div>
      <div>
        <div class="font-label-mono text-[11px] text-on-surface-variant tracking-[0.06em] uppercase mb-3">Connect</div>
        <div class="flex flex-col gap-1.5 font-label-mono text-[12px]">
          <a href="https://www.instagram.com/nottoday.nty/" target="_blank" rel="noopener noreferrer" class="text-on-surface-variant hover:text-secondary transition-colors w-fit">Instagram</a>
          <a href="#" class="text-on-surface-variant hover:text-secondary transition-colors w-fit">SoundCloud</a>
          <a href="#" class="text-on-surface-variant hover:text-secondary transition-colors w-fit">Spotify</a>
        </div>
      </div>
      <div>
        <div class="font-label-mono text-[11px] text-on-surface-variant tracking-[0.06em] uppercase mb-3">Info</div>
        <div class="flex flex-col gap-1.5 font-label-mono text-[12px]">
          <a href="about.html" class="text-on-surface-variant hover:text-secondary transition-colors w-fit">Sobre Nosotros</a>
          <a href="services.html" class="text-on-surface-variant hover:text-secondary transition-colors w-fit">Servicios</a>
          <a href="track.html" class="text-on-surface-variant hover:text-secondary transition-colors w-fit">Track Order</a>
          <a href="terms.html" class="text-on-surface-variant hover:text-secondary transition-colors w-fit">Terms</a>
          <a href="privacy.html" class="text-on-surface-variant hover:text-secondary transition-colors w-fit">Privacy</a>
        </div>
      </div>
      <div class="md:self-end font-label-mono text-[10px] text-on-surface-variant">© 2026 NOT TODAY COLLECTIVE. ALL RIGHTS RESERVED.</div>
    </footer>`;
  }

  // Mismos 4 botones que el nav de escritorio (LAB/SHOP/NEWSLETTER/CONTACTO),
  // cada uno al mismo destino que su label en escritorio (el texto entero es
  // un link, no solo el caret) — así el bottom nav no es un menú distinto,
  // es el mismo nav en formato de pestañas.
  function mobileNavHtml(active) {
    const ag = activeGroup(active);
    const tabs = [
      { group: "lab", href: "sessions.html", icon: "science", label: "LAB" },
      { group: "shop", href: "store.html", icon: "shopping_bag", label: "SHOP" },
      { group: "news", href: "newsletter.html", icon: "mail", label: "NEWSLETTER" },
      { group: "contacto", href: "booking.html", icon: "edit_calendar", label: "CONTACTO" },
    ];
    return `
    <nav class="md:hidden fixed bottom-0 left-0 right-0 z-[500] flex bg-[#050505] border-t border-outline-variant/30" style="padding-bottom:env(safe-area-inset-bottom);">
      ${tabs
        .map((t) => {
          const isActive = t.group === ag;
          return `<a href="${t.href}" class="flex-1 flex flex-col items-center gap-1 pt-3.5 pb-5 ${
            isActive ? "text-secondary" : "text-on-surface-variant"
          }">
            <span class="material-symbols-outlined text-[22px]">${t.icon}</span>
            <span class="font-label-mono text-[9px] tracking-[0.05em] uppercase">${t.label}</span>
          </a>`;
        })
        .join("")}
    </nav>`;
  }

  function wireDropdowns(root) {
    root.querySelectorAll(".nt-nav-item").forEach((item) => {
      const sub = item.querySelector(".nt-nav-sub");
      if (!sub) return;
      item.addEventListener("mouseenter", () => sub.classList.remove("hidden"));
      item.addEventListener("mouseleave", () => sub.classList.add("hidden"));
    });
  }

  // Revela el nav tras la primera interacción (o a los 3.2s) y, solo en home,
  // hace un morph ligado al scroll desde una posición baja (fin del hero)
  // hasta quedar pegado arriba — replica el lerp del diseño original.
  function wireReveal(wrap, bar, onHome) {
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      bar.style.transform = "translateY(0)";
      bar.style.opacity = "1";
    };
    window.addEventListener("scroll", reveal, { passive: true, once: true });
    window.addEventListener("mousemove", reveal, { passive: true, once: true });
    window.addEventListener("touchstart", reveal, { passive: true, once: true });
    window.addEventListener("keydown", reveal, { once: true });
    setTimeout(reveal, 3200);

    if (!onHome) {
      wrap.style.top = "0px";
      bar.style.padding = "14px 32px";
      bar.style.maxWidth = "2400px";
      bar.style.width = "100%";
      bar.style.justifyContent = "space-between";
      return;
    }

    let raf = null;
    const isMobile = () => window.innerWidth < 860;
    const update = () => {
      raf = null;

      // En móvil el nav va fijo arriba desde el principio, sin el morph de
      // "sube desde el hero" — ese efecto es solo para desktop en home.
      if (isMobile()) {
        wrap.style.top = "0px";
        wrap.style.padding = "0";
        bar.style.gap = "14px";
        bar.style.width = "100%";
        bar.style.maxWidth = "2400px";
        bar.style.justifyContent = "space-between";
        bar.style.padding = "14px 18px";
        bar.style.background = "rgba(9,9,9,0.88)";
        bar.style.border = "1px solid rgba(42,42,42,0)";
        bar.style.borderBottom = "1px solid rgba(60,60,60,0.35)";
        bar.style.boxShadow = "0 18px 50px rgba(0,0,0,0)";
        bar.classList.remove("nt-nav-upward");
        return;
      }

      const vh = window.innerHeight || 800;
      const travel = Math.max(220, vh * 0.62);
      const p = Math.min(1, Math.max(0, window.scrollY / travel));
      const lerp = (a, b) => a + (b - a) * p;
      const restTop = Math.max(120, vh - 79 - (isMobile() ? 74 : 0));
      const isTop = p > 0.985;

      wrap.style.top = Math.round(lerp(restTop, 0)) + "px";
      wrap.style.padding = "0 " + Math.round(lerp(20, 0)) + "px";
      bar.style.gap = Math.round(lerp(14, 22)) + "px";
      bar.style.width = "100%";
      bar.style.maxWidth = isTop ? "none" : Math.round(lerp(isMobile() ? 420 : 700, 2400)) + "px";
      bar.style.justifyContent = "space-between";
      bar.style.padding = Math.round(lerp(10, 14)) + "px " + Math.round(lerp(18, 32)) + "px";
      bar.style.background = "rgba(9,9,9," + lerp(0.72, 0.88).toFixed(3) + ")";
      bar.style.border = "1px solid rgba(42,42,42," + (1 - p).toFixed(3) + ")";
      bar.style.borderBottom = "1px solid rgba(60,60,60," + Math.max(0.35, 1 - p * 0.5).toFixed(3) + ")";
      bar.style.boxShadow = "0 18px 50px rgba(0,0,0," + lerp(0.55, 0).toFixed(3) + ")";

      // Mientras el nav está bajo (cerca del final del hero, aún no pegado
      // arriba), un submenú desplegado hacia abajo se saldría de la
      // ventana — se abre hacia arriba hasta que el nav llega arriba.
      bar.classList.toggle("nt-nav-upward", !isTop);
    };
    update();
    window.addEventListener(
      "scroll",
      () => {
        if (raf) return;
        raf = requestAnimationFrame(update);
      },
      { passive: true }
    );
    window.addEventListener("resize", update);
  }

  function mount(opts) {
    const options = opts || {};
    const active = options.active || null;
    const showFooter = options.showFooter !== false;

    const navHost = document.createElement("div");
    navHost.innerHTML = navHtml(active);
    document.body.insertBefore(navHost.firstElementChild, document.body.firstChild);

    const wrap = document.getElementById("nt-nav-wrap");
    const bar = document.getElementById("nt-nav-bar");
    wireDropdowns(wrap);
    wireReveal(wrap, bar, active === "home");

    if (showFooter) {
      const footerHost = document.createElement("div");
      footerHost.innerHTML = footerHtml();
      const footerEl = footerHost.firstElementChild;
      const main = document.querySelector("main");
      if (main) main.insertAdjacentElement("afterend", footerEl);
      else document.body.appendChild(footerEl);
    }

    const mobileHost = document.createElement("div");
    mobileHost.innerHTML = mobileNavHtml(active);
    document.body.appendChild(mobileHost.firstElementChild);
  }

  return { mount };
})();
