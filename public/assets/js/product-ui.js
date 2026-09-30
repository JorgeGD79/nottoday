// ============================================================
// NOT TODAY — ficha de producto compartida
//
// La usan el modal de la tienda (store.html) y la página de producto
// (/producto/:slug). Galería, variantes (talla / color), añadir al carrito
// y, si la variante está agotada o el drop no ha abierto, el formulario
// "Avísame" (POST /api/shop/notify).
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

  notifyFormHtml({ label }) {
    return `
      <form data-notify class="border border-secondary-container/50 p-stack-md space-y-3" novalidate>
        <p class="font-label-mono text-[12px] text-secondary-container uppercase tracking-wide">${ntEscapeHtml(label)}</p>
        <input type="email" required placeholder="TU EMAIL" autocomplete="email"
          class="w-full bg-surface-container-lowest border border-outline-variant text-on-surface px-3 py-3 font-body-md text-[14px] outline-none focus:border-secondary-container"/>
        <label class="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" data-notify-consent class="mt-0.5 bg-surface-container-lowest border-outline-variant text-secondary-container focus:ring-secondary-container"/>
          <span class="font-body-md text-[12px] text-on-surface-variant leading-snug">Acepto que me escribáis solo para este aviso (<a href="/privacy.html" class="underline text-secondary-container">privacidad</a>).</span>
        </label>
        <button type="submit" class="w-full border-2 border-secondary-container text-secondary-container font-label-mono text-[13px] tracking-widest uppercase font-bold py-3 hover:bg-secondary-container hover:text-on-secondary transition-colors">Avísame</button>
      </form>`;
  },

  // ---------- Selector de variante: color y talla por separado ----------
  // Lo usan la ficha (mount) y las tarjetas de la tienda. `pick` es el estado
  // de la elección: { color, size }; la variante es la combinación de ambos.

  variantOptions(p) {
    return {
      colors: [...new Set(p.variants.map((v) => v.color).filter(Boolean))],
      sizes: [...new Set(p.variants.map((v) => v.size))],
    };
  },

  findVariant(p, color, size) {
    return p.variants.find((v) => (v.color || "") === (color || "") && v.size === size) || null;
  },

  // Elección inicial: el primer color con stock y, si solo hay una talla, esa.
  initialPick(p) {
    const { colors, sizes } = this.variantOptions(p);
    const color = colors.find((c) => p.variants.some((v) => v.color === c && v.stockAvailable > 0)) || colors[0] || "";
    return { color, size: sizes.length === 1 ? sizes[0] : "" };
  },

  pickedVariant(p, pick) {
    return pick.size ? this.findVariant(p, pick.color, pick.size) : null;
  },

  /**
   * Filas de color y talla. Las tallas dependen del color elegido: las que no
   * existen en ese color se deshabilitan y las agotadas se tachan (en la ficha
   * se pueden elegir para pedir el aviso: opts.allowSoldOut).
   */
  pickerHtml(p, pick, { allowSoldOut = false, compact = false } = {}) {
    const { colors, sizes } = this.variantOptions(p);
    const label = (text, value) => `
      <span class="font-label-mono text-[11px] text-on-surface-variant uppercase tracking-widest block ${compact ? "mb-1" : "mb-2"}">
        ${text}${value ? ` · <span class="text-on-surface">${ntEscapeHtml(value)}</span>` : ""}
      </span>`;
    const rows = [];

    if (colors.length > 1) {
      rows.push(`<div>${label("Color", pick.color)}<div class="flex gap-2 flex-wrap">${colors.map((c) => {
        const out = !p.variants.some((v) => v.color === c && v.stockAvailable > 0);
        return `<button type="button" data-pick-color="${ntEscapeHtml(c)}"
          class="size-btn ${pick.color === c ? "selected" : ""} ${out ? "line-through opacity-50" : ""}"
          title="${out ? "Agotado en este color" : ""}">${ntEscapeHtml(c)}</button>`;
      }).join("")}</div></div>`);
    } else if (colors.length === 1) {
      rows.push(`<div>${label("Color", colors[0])}</div>`);
    }

    if (sizes.length > 1) {
      rows.push(`<div>${label("Talla", pick.size)}<div class="flex gap-2 flex-wrap">${sizes.map((s) => {
        const v = this.findVariant(p, pick.color, s);
        const out = !v || v.stockAvailable <= 0;
        const disabled = !v || (out && !allowSoldOut);
        return `<button type="button" data-pick-size="${ntEscapeHtml(s)}" ${disabled ? "disabled" : ""}
          class="size-btn ${pick.size === s ? "selected" : ""} ${out ? "line-through opacity-50" : ""}"
          title="${!v ? "No existe en este color" : out ? "Agotada — puedes pedir que te avisemos" : `${v.stockAvailable} disponibles`}">${ntEscapeHtml(s)}</button>`;
      }).join("")}</div></div>`);
    }

    return rows.join("");
  },

  // Conecta los botones del selector; onChange se llama tras cada cambio.
  bindPicker(root, p, pick, onChange) {
    const { sizes } = this.variantOptions(p);
    root.querySelectorAll("[data-pick-color]").forEach((b) =>
      b.addEventListener("click", () => {
        pick.color = b.dataset.pickColor;
        // La talla elegida se mantiene si existe en el nuevo color.
        if (pick.size && !this.findVariant(p, pick.color, pick.size)) pick.size = sizes.length === 1 ? sizes[0] : "";
        onChange();
      }));
    root.querySelectorAll("[data-pick-size]:not(:disabled)").forEach((b) =>
      b.addEventListener("click", () => { pick.size = b.dataset.pickSize; onChange(); }));
  },

  /**
   * Pinta la ficha dentro de `root` y gestiona su estado.
   * opts.modal: muestra botón de cerrar (opts.onClose) y enlace a la ficha completa.
   */
  mount(root, product, opts = {}) {
    const state = { img: 0, pick: this.initialPick(product) };

    const render = () => {
      const p = product;
      const images = p.images && p.images.length ? p.images : [ntPlaceholderImage(p.name)];
      const dropLocked = this.isDropLocked(p);
      const soldOut = this.isSoldOut(p);
      const selected = this.pickedVariant(p, state.pick);
      const selectedSoldOut = selected && selected.stockAvailable <= 0;

      const thumbs = images.length > 1
        ? `<div class="flex gap-px bg-outline-variant/40">${images.map((img, i) => `
            <button type="button" data-thumb="${i}" class="flex-1 h-16 bg-surface-container-lowest overflow-hidden border-b-2 ${i === state.img ? "border-secondary-container" : "border-transparent"}">
              <img src="${ntEscapeHtml(img)}" class="w-full h-full object-cover" alt="${ntEscapeHtml(p.name)} — foto ${i + 1}"/>
            </button>`).join("")}</div>`
        : "";

      const picker = this.pickerHtml(p, state.pick, { allowSoldOut: true });

      // Acción principal: comprar, o "avísame" (drop cerrado / variante agotada).
      let action;
      if (dropLocked) {
        action = this.notifyFormHtml({ label: `Sale el ${new Date(p.dropMeta.releaseAt).toLocaleString("es-ES", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}. ¿Te avisamos?` });
      } else if (selectedSoldOut || (soldOut && !selected)) {
        action = this.notifyFormHtml({
          label: selected ? `${ntVariantLabel(selected)} agotada. Te avisamos si vuelve.` : "Agotado. Elige talla y te avisamos si vuelve.",
        });
      } else {
        action = `<button type="button" data-add class="w-full bg-secondary-container text-on-secondary font-label-mono text-[13px] tracking-widest uppercase font-bold py-4 hover:bg-on-surface hover:text-primary-container transition-colors disabled:opacity-30">Añadir al carrito</button>`;
      }

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
                ${p.productType === "DROP_EXCLUSIVO" ? "Drop exclusivo" : p.category ? `<a href="/tienda/${encodeURIComponent(p.category.slug)}" class="hover:text-secondary-container">${ntEscapeHtml(p.category.name)}</a>` : "Tienda"}
              </span>
              ${opts.modal ? `<h2 class="font-headline-xl text-[28px] text-on-surface uppercase leading-none mt-1">${ntEscapeHtml(p.name)}</h2>`
                           : `<h1 class="font-headline-xl text-[32px] md:text-[44px] text-on-surface uppercase leading-none mt-1">${ntEscapeHtml(p.name)}</h1>`}
              <p class="font-label-mono text-label-mono text-secondary-container mt-2">${ntFormatMoney(p.price)} <span class="text-on-surface-variant text-[11px]">IVA incl.</span></p>
            </div>
            ${p.description ? `<p class="font-body-md text-body-md text-on-surface-variant whitespace-pre-line">${ntEscapeHtml(p.description)}</p>` : ""}
            ${picker ? `<div class="space-y-stack-sm">${picker}</div>` : ""}
            <div class="mt-auto space-y-3">
              ${action}
              ${opts.modal ? `<a href="${this.productUrl(p)}" class="block text-center font-label-mono text-[11px] text-on-surface-variant uppercase tracking-widest hover:text-secondary-container">Ver ficha completa →</a>` : ""}
            </div>
          </div>
        </div>`;

      root.querySelectorAll("[data-thumb]").forEach((b) =>
        b.addEventListener("click", () => { state.img = Number(b.dataset.thumb); render(); }));
      this.bindPicker(root, p, state.pick, render);
      const close = root.querySelector("[data-close]");
      if (close && opts.onClose) close.addEventListener("click", opts.onClose);

      const add = root.querySelector("[data-add]");
      if (add) {
        add.addEventListener("click", async () => {
          if (!selected) { ntToast(state.pick.color || !this.variantOptions(p).colors.length ? "Elige una talla" : "Elige color y talla", true); return; }
          add.disabled = true;
          try {
            await NTCart.add({ productId: p.id, productVariantId: selected.id, quantity: 1 });
            ntToast("Añadido al carrito");
            if (opts.onAdded) opts.onAdded();
          } catch (err) {
            ntToast(err.message, true);
          } finally {
            add.disabled = false;
          }
        });
      }

      const form = root.querySelector("[data-notify]");
      if (form) {
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const email = form.querySelector("input[type=email]").value.trim();
          if (!/.+@.+\..+/.test(email)) { ntToast("Email no válido", true); return; }
          if (!form.querySelector("[data-notify-consent]").checked) { ntToast("Acepta que te escribamos para el aviso", true); return; }
          // En un drop cerrado el aviso es de apertura (sin variante).
          const body = { productId: p.id, email, consent: true };
          if (!dropLocked && selected) body.productVariantId = selected.id;
          const btn = form.querySelector("button[type=submit]");
          btn.disabled = true;
          try {
            await ntApi("/shop/notify", { method: "POST", body: JSON.stringify(body) });
            form.innerHTML = `<p class="font-label-mono text-[12px] text-secondary-container uppercase">Hecho. Te escribiremos una sola vez.</p>`;
          } catch (err) {
            ntToast(err.status === 429 ? "Demasiados intentos, espera un minuto" : err.message, true);
            btn.disabled = false;
          }
        });
      }
    };

    render();
  },
};
