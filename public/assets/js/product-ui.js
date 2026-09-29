// ============================================================
// NOT TODAY — ficha de producto compartida
//
// La usan el modal de la tienda (store.html) y la página de producto
// (/producto/:slug). Galería, variantes (talla / color) y añadir al carrito.
// ============================================================

const NTProductUI = {
  isDropLocked(p) {
    return !!(p.dropMeta && p.dropMeta.dropStatus !== "ABIERTO");
  },

  isSoldOut(p) {
    return p.status === "AGOTADO" || !p.variants.length || p.variants.every((v) => v.stockAvailable <= 0);
  },

  productUrl(p) {
    return `/producto/${encodeURIComponent(p.slug)}`;
  },

  /**
   * Pinta la ficha dentro de `root` y gestiona su estado.
   * opts.modal: muestra botón de cerrar (opts.onClose) y enlace a la ficha completa.
   */
  mount(root, product, opts = {}) {
    const state = { img: 0, variantId: null };
    // Si solo hay una variante (talla única), queda elegida de entrada.
    if (product.variants.length === 1) state.variantId = product.variants[0].id;

    const render = () => {
      const p = product;
      const images = p.images && p.images.length ? p.images : [ntPlaceholderImage(p.name)];
      const dropLocked = this.isDropLocked(p);
      const soldOut = this.isSoldOut(p);
      const singleVariant = p.variants.length === 1;

      const thumbs = images.length > 1
        ? `<div class="flex gap-px bg-outline-variant/40">${images.map((img, i) => `
            <button type="button" data-thumb="${i}" class="flex-1 h-16 bg-surface-container-lowest overflow-hidden border-b-2 ${i === state.img ? "border-secondary-container" : "border-transparent"}">
              <img src="${ntEscapeHtml(img)}" class="w-full h-full object-cover" alt=""/>
            </button>`).join("")}</div>`
        : "";

      const variantBtns = p.variants.map((v) => {
        const out = v.stockAvailable <= 0;
        return `<button type="button" data-variant="${v.id}" ${out ? "disabled" : ""}
            class="size-btn ${state.variantId === v.id ? "selected" : ""}"
            title="${out ? "Agotado" : `${v.stockAvailable} disponibles`}">${ntEscapeHtml(ntVariantLabel(v))}</button>`;
      }).join("");

      const canBuy = !soldOut && !dropLocked;
      const action = `
        ${dropLocked ? `<p class="font-label-mono text-[12px] text-secondary-container uppercase">Disponible el ${new Date(p.dropMeta.releaseAt).toLocaleString("es-ES", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}</p>` : ""}
        <button type="button" data-add ${canBuy ? "" : "disabled"} class="w-full bg-secondary-container text-on-secondary font-label-mono text-[13px] tracking-widest uppercase font-bold py-4 hover:bg-on-surface hover:text-primary-container transition-colors disabled:opacity-30 disabled:cursor-not-allowed">${soldOut ? "Agotado" : dropLocked ? "Próximamente" : "Añadir al carrito"}</button>`;

      root.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2">
          <div class="border-b md:border-b-0 md:border-r border-outline-variant">
            <div class="w-full aspect-square bg-surface-container overflow-hidden border-b border-outline-variant">
              <img src="${ntEscapeHtml(images[state.img])}" class="w-full h-full object-cover" alt="${ntEscapeHtml(p.name)}"/>
            </div>
            ${thumbs}
          </div>
          <div class="p-stack-md flex flex-col gap-stack-md relative">
            ${opts.modal ? `<button type="button" data-close class="self-end text-on-surface-variant hover:text-secondary-container transition-colors p-1" aria-label="Cerrar"><span class="material-symbols-outlined text-2xl">close</span></button>` : ""}
            <div>
              <span class="font-label-mono text-[11px] uppercase tracking-widest ${p.productType === "DROP_EXCLUSIVO" ? "text-secondary-container" : "text-on-surface-variant"}">
                ${p.productType === "DROP_EXCLUSIVO" ? "Drop exclusivo" : p.category ? `<a href="/store.html?categoria=${encodeURIComponent(p.category.slug)}" class="hover:text-secondary-container">${ntEscapeHtml(p.category.name)}</a>` : "Tienda"}
              </span>
              ${opts.modal ? `<h2 class="font-headline-xl text-[28px] text-on-surface uppercase leading-none mt-1">${ntEscapeHtml(p.name)}</h2>`
                           : `<h1 class="font-headline-xl text-[32px] md:text-[44px] text-on-surface uppercase leading-none mt-1">${ntEscapeHtml(p.name)}</h1>`}
              <p class="font-label-mono text-label-mono text-secondary-container mt-2">${ntFormatMoney(p.price)}</p>
            </div>
            ${p.description ? `<p class="font-body-md text-body-md text-on-surface-variant whitespace-pre-line">${ntEscapeHtml(p.description)}</p>` : ""}
            ${singleVariant ? "" : `
            <div>
              <span class="font-label-mono text-[11px] text-on-surface-variant uppercase tracking-widest block mb-2">Talla${p.variants.some((v) => v.color) ? " / color" : ""}</span>
              <div class="flex gap-2 flex-wrap">${variantBtns}</div>
            </div>`}
            <div class="mt-auto space-y-3">
              ${action}
              ${opts.modal ? `<a href="${this.productUrl(p)}" class="block text-center font-label-mono text-[11px] text-on-surface-variant uppercase tracking-widest hover:text-secondary-container">Ver ficha completa →</a>` : ""}
            </div>
          </div>
        </div>`;

      root.querySelectorAll("[data-thumb]").forEach((b) =>
        b.addEventListener("click", () => { state.img = Number(b.dataset.thumb); render(); }));
      root.querySelectorAll("[data-variant]:not(:disabled)").forEach((b) =>
        b.addEventListener("click", () => { state.variantId = b.dataset.variant; render(); }));
      const close = root.querySelector("[data-close]");
      if (close && opts.onClose) close.addEventListener("click", opts.onClose);

      const add = root.querySelector("[data-add]");
      if (add && canBuy) {
        add.addEventListener("click", async () => {
          if (!state.variantId) { ntToast("Elige una talla primero", true); return; }
          add.disabled = true;
          try {
            await NTCart.add({ productId: p.id, productVariantId: state.variantId, quantity: 1 });
            ntToast("Añadido al carrito");
            if (opts.onAdded) opts.onAdded();
          } catch (err) {
            ntToast(err.message, true);
          } finally {
            add.disabled = false;
          }
        });
      }

    };

    render();
  },
};
