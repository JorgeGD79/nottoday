// ============================================================
// NOT TODAY — carrito compartido (panel lateral) para todas las páginas
//
// Estado: el backend es la fuente de verdad; aquí solo guardamos el cartId
// en localStorage y pintamos lo que devuelve GET /api/cart/:id.
// ============================================================

const NT_CART_KEY = "nottoday:cartId";

const NTCart = {
  cart: null,

  get cartId() {
    return localStorage.getItem(NT_CART_KEY);
  },

  saveCartId(id) {
    localStorage.setItem(NT_CART_KEY, id);
  },

  clear() {
    localStorage.removeItem(NT_CART_KEY);
    this.cart = null;
    this.render();
  },

  async load() {
    if (!this.cartId) return this.render();
    try {
      const { cart } = await ntApi(`/cart/${this.cartId}`);
      // Un carrito ya convertido en pedido no debe reutilizarse.
      if (cart.status !== "ACTIVO") return this.clear();
      this.cart = cart;
    } catch (err) {
      if (err.status === 404) localStorage.removeItem(NT_CART_KEY);
      this.cart = null;
    }
    this.render();
  },

  async add({ productId, productVariantId, quantity = 1 }) {
    const payload = { productId, productVariantId, quantity };
    if (this.cartId) payload.cartId = this.cartId;

    const { cart } = await ntApi("/cart/items", { method: "POST", body: JSON.stringify(payload) });
    this.saveCartId(cart.id);
    this.cart = cart;
    this.render();
    this.open();
  },

  async remove(productVariantId) {
    if (!this.cartId) return;
    const { cart } = await ntApi(`/cart/${this.cartId}/items/${productVariantId}`, { method: "DELETE" });
    this.cart = cart;
    this.render();
  },

  async setQuantity(productVariantId, quantity) {
    if (!this.cartId) return;
    const { cart } = await ntApi(`/cart/${this.cartId}/items/${productVariantId}`, {
      method: "PATCH",
      body: JSON.stringify({ quantity }),
    });
    this.cart = cart;
    this.render();
  },

  async applyDiscount(code) {
    if (!this.cartId) throw new Error("El carrito está vacío");
    const { cart } = await ntApi("/cart/discount", {
      method: "POST",
      body: JSON.stringify({ cartId: this.cartId, code }),
    });
    this.cart = cart;
    this.render();
  },

  subtotal() {
    if (!this.cart) return 0;
    return this.cart.items.reduce((sum, i) => sum + Number(i.product.price) * i.quantity, 0);
  },

  // Estimación visual del descuento; la cifra definitiva la fija el checkout.
  discountAmount() {
    const d = this.cart && this.cart.discountCode;
    if (!d) return 0;
    const subtotal = this.subtotal();
    if (d.type === "PORCENTAJE") return (subtotal * Number(d.value)) / 100;
    if (d.type === "MONTO_FIJO") return Math.min(Number(d.value), subtotal);
    return 0; // ENVIO_GRATIS no altera el total de producto
  },

  count() {
    if (!this.cart) return 0;
    return this.cart.items.reduce((sum, i) => sum + i.quantity, 0);
  },

  // ---------- UI ----------

  open() {
    const backdrop = document.getElementById("cart-backdrop");
    const panel = document.getElementById("cart-panel");
    backdrop.classList.remove("hidden");
    setTimeout(() => {
      backdrop.classList.remove("opacity-0");
      panel.classList.remove("translate-x-full");
    }, 10);
    document.body.style.overflow = "hidden";
  },

  close() {
    const backdrop = document.getElementById("cart-backdrop");
    const panel = document.getElementById("cart-panel");
    backdrop.classList.add("opacity-0");
    panel.classList.add("translate-x-full");
    setTimeout(() => {
      backdrop.classList.add("hidden");
      document.body.style.overflow = "";
    }, 300);
  },

  renderBadge() {
    const count = this.count();
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = count;
      el.classList.toggle("hidden", count === 0);
      el.classList.toggle("flex", count > 0);
    });
  },

  render() {
    this.renderBadge();
    const itemsEl = document.getElementById("cart-items");
    const totalsEl = document.getElementById("cart-totals");
    if (!itemsEl || !totalsEl) return;

    if (!this.cart || this.cart.items.length === 0) {
      itemsEl.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full text-center gap-stack-md py-16">
          <span class="material-symbols-outlined text-5xl text-on-surface-variant">shopping_bag</span>
          <p class="font-label-mono text-label-mono text-on-surface-variant uppercase">El carrito está vacío</p>
          <a href="store.html" class="font-headline-lg text-[20px] uppercase text-secondary hover:text-on-surface transition-colors">Ir a la tienda -&gt;</a>
        </div>`;
      totalsEl.innerHTML = "";
      return;
    }

    itemsEl.innerHTML = this.cart.items
      .map(
        (item) => `
        <div class="relative flex gap-stack-md p-stack-sm border border-outline-variant/20 bg-primary-container">
          <button data-remove="${item.productVariant.id}" aria-label="Eliminar del carrito"
            class="absolute top-1 right-1 text-on-surface-variant hover:text-error transition-colors p-1">
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
          <div class="w-24 h-32 bg-surface-container flex-shrink-0 border border-outline-variant/20 overflow-hidden">
            <img class="w-full h-full object-cover mix-blend-luminosity" src="${ntProductImage(item.product)}" alt="${ntEscapeHtml(item.product.name)}"/>
          </div>
          <div class="flex flex-col flex-grow justify-between py-1">
            <div>
              <h3 class="font-headline-lg text-headline-lg-mobile text-on-surface uppercase leading-none">${ntEscapeHtml(item.product.name)}</h3>
              <p class="font-label-mono text-label-mono text-on-surface-variant mt-1">Talla: ${item.productVariant.size}</p>
            </div>
            <div class="flex justify-between items-center mt-4 gap-2">
              <div class="flex items-center border border-outline-variant/30">
                <button data-qty="dec" data-variant="${item.productVariant.id}" aria-label="Quitar una unidad"
                  class="w-8 h-8 flex items-center justify-center text-on-surface hover:text-secondary transition-colors">
                  <span class="material-symbols-outlined text-[18px]">remove</span>
                </button>
                <span class="w-8 text-center font-label-mono text-label-mono text-on-surface">${item.quantity}</span>
                <button data-qty="inc" data-variant="${item.productVariant.id}" aria-label="Añadir una unidad"
                  class="w-8 h-8 flex items-center justify-center text-on-surface hover:text-secondary transition-colors">
                  <span class="material-symbols-outlined text-[18px]">add</span>
                </button>
              </div>
              <span class="font-label-mono text-label-mono text-secondary">${ntFormatMoney(Number(item.product.price) * item.quantity)}</span>
            </div>
          </div>
        </div>`
      )
      .join("");

    const subtotal = this.subtotal();
    const discount = this.discountAmount();
    const freeShipping = !!(this.cart.discountCode && this.cart.discountCode.type === "ENVIO_GRATIS");
    const total = Math.max(subtotal - discount, 0);
    const discountRow = this.cart.discountCode
      ? `<div class="flex justify-between items-center mb-stack-sm">
           <span class="font-label-mono text-label-mono text-secondary uppercase">Cupón ${ntEscapeHtml(this.cart.discountCode.code)}</span>
           <span class="font-label-mono text-label-mono text-secondary">${freeShipping ? "Envío gratis" : "-" + ntFormatMoney(discount)}</span>
         </div>`
      : "";

    // El envío se elige y se suma en la página de pago (checkout.html).
    totalsEl.innerHTML = `
      <div class="flex justify-between items-center mb-stack-sm">
        <span class="font-label-mono text-label-mono text-on-surface-variant uppercase">Subtotal</span>
        <span class="font-label-mono text-label-mono text-on-surface">${ntFormatMoney(subtotal)}</span>
      </div>
      ${discountRow}
      <div class="flex justify-between items-center mb-stack-sm border-t border-outline-variant/30 pt-stack-sm">
        <span class="font-label-mono text-label-mono text-on-surface-variant uppercase">Total</span>
        <span class="font-headline-lg text-headline-lg-mobile text-on-surface">${ntFormatMoney(total)}</span>
      </div>
      <p class="font-label-mono text-[10px] text-on-surface-variant uppercase tracking-wide mb-stack-md">Envío e impuestos se calculan en el pago</p>`;

    // Botones de eliminar (la X de cada línea).
    itemsEl.querySelectorAll("[data-remove]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await this.remove(btn.dataset.remove);
          ntToast("Producto eliminado");
        } catch (err) {
          ntToast(err.message, true);
          btn.disabled = false;
        }
      })
    );

    // Botones de cantidad (− / +). En 1, el − elimina la línea (quantity 0).
    itemsEl.querySelectorAll("[data-qty]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const variantId = btn.dataset.variant;
        const item = this.cart.items.find((i) => i.productVariant.id === variantId);
        if (!item) return;
        const next = btn.dataset.qty === "inc" ? item.quantity + 1 : item.quantity - 1;
        btn.disabled = true;
        try {
          await this.setQuantity(variantId, next);
        } catch (err) {
          ntToast(err.message, true);
          btn.disabled = false;
        }
      })
    );
  },

  // Inyecta el panel + backdrop una sola vez por página.
  mount() {
    const host = document.createElement("div");
    host.innerHTML = `
      <div class="fixed inset-0 bg-primary-container/90 backdrop-blur-sm z-[60] hidden opacity-0 transition-opacity duration-300" id="cart-backdrop"></div>
      <div class="fixed top-0 right-0 h-full w-full md:w-[450px] bg-surface-container-lowest border-l-2 border-on-surface transform translate-x-full transition-transform duration-300 ease-in-out z-[61] flex flex-col shadow-2xl" id="cart-panel">
        <div class="p-stack-md border-b border-outline-variant/20 flex justify-between items-center bg-primary-container">
          <h2 class="font-display-lg text-headline-lg uppercase text-on-surface m-0 leading-none">Cart</h2>
          <button class="text-on-surface hover:text-secondary transition-colors" id="close-cart" aria-label="Cerrar carrito">
            <span class="material-symbols-outlined text-3xl">close</span>
          </button>
        </div>

        <div class="flex-grow overflow-y-auto p-stack-md space-y-stack-md" id="cart-items"></div>

        <div class="p-stack-md border-t border-outline-variant/20 bg-primary-container" id="cart-footer">
          <form id="discount-form" class="flex gap-2 mb-stack-md">
            <input type="text" id="discount-code" class="nt-input flex-grow" placeholder="Código de descuento" autocomplete="off"/>
            <button type="submit" class="font-label-mono text-label-mono uppercase border border-outline-variant/20 px-4 text-on-surface hover:border-secondary transition-colors">Aplicar</button>
          </form>
          <div id="cart-totals"></div>
          <button id="cart-pay-btn" class="w-full bg-secondary-container text-primary-container font-headline-lg text-headline-lg-mobile uppercase py-4 hover:bg-on-surface transition-colors border-2 border-secondary-container hover:border-on-surface mt-2">
            Realizar pago
          </button>
        </div>
      </div>`;
    document.body.appendChild(host);

    document.getElementById("close-cart").addEventListener("click", () => this.close());
    document.getElementById("cart-backdrop").addEventListener("click", () => this.close());
    document.querySelectorAll("[data-cart-toggle]").forEach((btn) =>
      btn.addEventListener("click", () => this.open())
    );

    document.getElementById("discount-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = document.getElementById("discount-code").value.trim();
      if (!code) return;
      try {
        await this.applyDiscount(code);
        ntToast("Cupón aplicado");
      } catch (err) {
        ntToast(err.message, true);
      }
    });

    // "Realizar pago": lleva a la página de checkout (dirección, pago y envío).
    document.getElementById("cart-pay-btn").addEventListener("click", () => {
      if (!this.cart || this.cart.items.length === 0) {
        ntToast("El carrito está vacío", true);
        return;
      }
      window.location.href = "checkout.html";
    });
  },
};

document.addEventListener("DOMContentLoaded", () => {
  NTCart.mount();
  NTCart.load();
});
