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
    { label: "ARTISTS", href: "artists.html" },
    { label: "PROJECTS", href: "projects.html" },
  ];
  const CONTACT_ITEMS = [
    { label: "BOOKING", href: "booking.html" },
    { label: "SOBRE NOSOTROS", href: "about.html" },
    { label: "SERVICIOS", href: "services.html" },
  ];
  const LAB_VIEWS = ["sessions", "radio", "artists", "projects"];
  const CONTACT_VIEWS = ["booking", "about", "services"];

  function activeGroup(active) {
    if (active === "store") return "shop";
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

  // Un grupo mobile es un rótulo mudo (no clicable) + sus enlaces debajo,
  // misma agrupación que el dropdown de escritorio pero sin acordeón: en
  // móvil no hay hover, así que en vez de reproducir el toggle mostramos
  // todo ya abierto dentro del panel de pantalla completa.
  function mobileGroupHtml(label, items, ag, group) {
    const isActive = ag === group;
    return `
      <div class="pt-6 first:pt-0">
        <div class="font-label-mono text-[10px] tracking-[0.18em] uppercase ${
          isActive ? "text-secondary" : "text-on-surface-variant"
        } mb-2">${label}</div>
        ${items
          .map(
            (it) =>
              `<a href="${it.href}" class="block py-3 font-headline-lg text-[20px] uppercase text-on-surface hover:text-secondary transition-colors">${it.label}</a>`
          )
          .join("")}
      </div>`;
  }

  function mobileLinkHtml(label, href, ag, group) {
    const isActive = ag === group;
    return `<a href="${href}" class="block pt-6 first:pt-0 font-headline-lg text-[20px] uppercase ${
      isActive ? "text-secondary" : "text-on-surface"
    } hover:text-secondary transition-colors">${label}</a>`;
  }

  function navHtml(active) {
    const ag = activeGroup(active);
    const items = [
      navItemHtml("lab", "LAB", { activeGroup: ag, href: "sessions.html", children: LAB_ITEMS }),
      navItemHtml("shop", "SHOP", { activeGroup: ag, href: "store.html" }),
      navItemHtml("news", "NEWSLETTER", { activeGroup: ag, href: "newsletter.html" }),
      navItemHtml("contacto", "CONTACTO", { activeGroup: ag, href: "booking.html", children: CONTACT_ITEMS }),
    ].join("");

    // Panel móvil a pantalla completa con la MISMA estructura que el nav de
    // escritorio (LAB agrupado, SHOP, NEWSLETTER, CONTACTO agrupado) — el
    // hover no existe en táctil, así que aquí va todo ya desplegado.
    const mobileMenu = [
      mobileGroupHtml("LAB", LAB_ITEMS, ag, "lab"),
      mobileLinkHtml("SHOP", "store.html", ag, "shop"),
      mobileLinkHtml("NEWSLETTER", "newsletter.html", ag, "news"),
      mobileGroupHtml("CONTACTO", CONTACT_ITEMS, ag, "contacto"),
    ].join("");

    return `
    <div id="nt-nav-wrap" style="position:fixed;left:0;right:0;z-index:600;display:flex;justify-content:center;pointer-events:none;">
      <nav id="nt-nav-bar" style="pointer-events:auto;display:flex;align-items:center;gap:14px;background:rgba(9,9,9,0.85);border:1px solid #2a2a2a;border-bottom:1px solid #3c3c3c;backdrop-filter:blur(14px);box-shadow:0 18px 50px rgba(0,0,0,0.45);transform:translateY(220%);opacity:0;transition:transform 1.15s cubic-bezier(.16,1,.3,1), opacity .9s ease, background .4s ease;">
        <a href="index.html" class="font-label-mono font-bold text-[16px] tracking-[0.06em] uppercase text-on-surface whitespace-nowrap" style="text-decoration:none;">NOT TODAY</a>
        <div class="hidden md:block" style="width:1px;height:20px;background:#444748;"></div>
        <div id="nt-nav-items" class="hidden md:flex items-stretch">${items}</div>
        <button id="nt-mobile-menu-toggle" aria-label="Abrir menú" aria-expanded="false" class="md:hidden relative flex items-center justify-center p-1.5 text-on-surface hover:text-secondary transition-colors">
          <span class="material-symbols-outlined text-[22px]">menu</span>
        </button>
        <button data-cart-toggle aria-label="Abrir carrito" class="relative flex items-center justify-center p-1.5 text-on-surface hover:text-secondary transition-colors">
          <span class="material-symbols-outlined text-[20px]">shopping_bag</span>
          <span data-cart-count class="hidden absolute -top-0.5 -right-0.5 bg-secondary-container text-primary-container font-label-mono text-[10px] w-4 h-4 items-center justify-center">0</span>
        </button>
      </nav>
    </div>
    <div id="nt-mobile-menu" class="md:hidden hidden fixed inset-0 z-[650] bg-[rgba(5,5,5,0.97)] backdrop-blur-md flex-col overflow-y-auto">
      <div class="flex justify-between items-center px-margin-mobile py-5 border-b border-outline-variant/20">
        <span class="font-label-mono font-bold text-[16px] tracking-[0.06em] uppercase text-on-surface">NOT TODAY</span>
        <button id="nt-mobile-menu-close" aria-label="Cerrar menú" class="p-1.5 text-on-surface hover:text-secondary transition-colors">
          <span class="material-symbols-outlined text-[24px]">close</span>
        </button>
      </div>
      <div class="px-margin-mobile py-2 pb-24 flex flex-col divide-y divide-outline-variant/10">${mobileMenu}</div>
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

  function mobileNavHtml(active) {
    const tabs = [
      { key: "sessions", href: "sessions.html", icon: "headphones", label: "Listen" },
      { key: "store", href: "store.html", icon: "shopping_bag", label: "Shop" },
      { key: "artists", href: "artists.html", icon: "group", label: "Artists" },
      { key: "booking", href: "booking.html", icon: "edit_calendar", label: "Book" },
    ];
    return `
    <nav class="md:hidden fixed bottom-0 left-0 right-0 z-[500] flex bg-[#050505] border-t border-outline-variant/30">
      ${tabs
        .map((t) => {
          const isActive = t.key === active;
          return `<a href="${t.href}" class="flex-1 flex flex-col items-center gap-0.5 pt-2.5 pb-3.5 ${
            isActive ? "text-secondary" : "text-on-surface-variant"
          }">
            <span class="material-symbols-outlined text-[22px]">${t.icon}</span>
            <span class="font-label-mono text-[9px] tracking-[0.05em] uppercase">${t.label}</span>
          </a>`;
        })
        .join("")}
    </nav>`;
  }

  // Panel móvil: el toggle abre/cierra el mismo árbol de enlaces que el
  // dropdown de escritorio (ver mobileGroupHtml/mobileLinkHtml arriba),
  // como overlay a pantalla completa en vez de hover.
  function wireMobileMenu() {
    const toggle = document.getElementById("nt-mobile-menu-toggle");
    const close = document.getElementById("nt-mobile-menu-close");
    const menu = document.getElementById("nt-mobile-menu");
    if (!toggle || !menu) return;
    const icon = toggle.querySelector(".material-symbols-outlined");

    const open = () => {
      menu.classList.remove("hidden");
      menu.classList.add("flex");
      toggle.setAttribute("aria-expanded", "true");
      if (icon) icon.textContent = "close";
      document.body.style.overflow = "hidden";
    };
    const closeMenu = () => {
      menu.classList.add("hidden");
      menu.classList.remove("flex");
      toggle.setAttribute("aria-expanded", "false");
      if (icon) icon.textContent = "menu";
      document.body.style.overflow = "";
    };

    toggle.addEventListener("click", () => {
      if (menu.classList.contains("hidden")) open();
      else closeMenu();
    });
    if (close) close.addEventListener("click", closeMenu);
    menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMenu));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
    // Si el viewport pasa a escritorio con el panel abierto (rotación,
    // resize de ventana), ciérralo — su toggle vive oculto en ese ancho.
    window.addEventListener("resize", () => {
      if (window.innerWidth >= 768 && !menu.classList.contains("hidden")) closeMenu();
    });
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

    // navHtml() devuelve dos elementos raíz (nav + panel móvil a pantalla
    // completa) — hay que insertarlos todos, no solo el primero.
    const navHost = document.createElement("div");
    navHost.innerHTML = navHtml(active);
    const insertRef = document.body.firstChild;
    Array.from(navHost.children).forEach((el) => document.body.insertBefore(el, insertRef));

    const wrap = document.getElementById("nt-nav-wrap");
    const bar = document.getElementById("nt-nav-bar");
    wireDropdowns(wrap);
    wireMobileMenu();
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
