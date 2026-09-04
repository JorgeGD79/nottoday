// ============================================================
// NOT TODAY — página de checkout (checkout.html)
//
// Flujo: lee el carrito (creado en cart.js) por su id en localStorage,
// pinta el resumen + los datos de envío/pago y, al pulsar "Pagar", llama a
// POST /api/checkout y muestra la confirmación con el número de pedido.
// Reutiliza los helpers globales de api.js (ntApi, ntFormatMoney, ...).
// ============================================================

// Nota: cart.js (cargado antes en checkout.html) ya declara NT_CART_KEY en el
// scope global compartido; usamos otro nombre aquí para no redeclararlo.
const CO_CART_KEY = "nottoday:cartId";

// Métodos de pago ofrecidos. La elección es informativa por ahora: con Stripe
// real, el Payment Element gestiona tarjeta/wallet automáticamente.
const PAYMENT_METHODS = [
  { id: "card", label: "Tarjeta", icon: "credit_card" },
  { id: "apple", label: "Apple Pay", icon: "phone_iphone" },
  { id: "google", label: "Google Pay", icon: "wallet" },
];

const Checkout = {
  cart: null,
  shippingMethods: [],
  selectedShippingId: null,
  paymentMethod: "card",

  cartId() {
    return localStorage.getItem(CO_CART_KEY);
  },

  // ---------- Cálculo de totales (misma lógica que el panel del carrito) ----------

  subtotal() {
    if (!this.cart) return 0;
    return this.cart.items.reduce((sum, i) => sum + Number(i.product.price) * i.quantity, 0);
  },

  freeShipping() {
    return !!(this.cart && this.cart.discountCode && this.cart.discountCode.type === "ENVIO_GRATIS");
  },

  discountAmount() {
    const d = this.cart && this.cart.discountCode;
    if (!d) return 0;
    const subtotal = this.subtotal();
    if (d.type === "PORCENTAJE") return (subtotal * Number(d.value)) / 100;
    if (d.type === "MONTO_FIJO") return Math.min(Number(d.value), subtotal);
    return 0; // ENVIO_GRATIS no altera el total de producto
  },

  shippingCost() {
    if (this.freeShipping()) return 0;
    const method = this.shippingMethods.find((m) => m.id === this.selectedShippingId);
    return method ? Number(method.price) : 0;
  },

  total() {
    return Math.max(this.subtotal() - this.discountAmount(), 0) + this.shippingCost();
  },

  // ---------- Carga inicial ----------

  async init() {
    const id = this.cartId();
    if (!id) return this.showEmpty();
    try {
      const [{ cart }, shipping] = await Promise.all([
        ntApi(`/cart/${id}`),
        ntApi("/shipping").catch(() => ({ methods: [] })),
      ]);
      if (!cart || cart.status !== "ACTIVO" || cart.items.length === 0) return this.showEmpty();
      this.cart = cart;
      this.shippingMethods = shipping.methods || [];
      if (this.shippingMethods.length) this.selectedShippingId = this.shippingMethods[0].id;
    } catch (err) {
      if (err.status === 404) localStorage.removeItem(CO_CART_KEY);
      return this.showEmpty();
    }

    document.getElementById("loading-state").classList.add("hidden");
    document.getElementById("checkout-view").classList.remove("hidden");
    this.renderPaymentMethods();
    this.renderShippingOptions();
    this.renderSummary();
    this.wire();
  },

  showEmpty() {
    document.getElementById("loading-state").classList.add("hidden");
    document.getElementById("checkout-view").classList.add("hidden");
    document.getElementById("empty-state").classList.remove("hidden");
  },

  // ---------- Render ----------

  renderPaymentMethods() {
    const box = document.getElementById("payment-methods");
    box.innerHTML = PAYMENT_METHODS.map((m) => {
      const active = m.id === this.paymentMethod;
      return `
        <button type="button" data-pay-method="${m.id}"
          class="flex flex-col items-center justify-center gap-2 border-2 ${active ? "border-secondary text-secondary" : "border-outline-variant/30 text-on-surface-variant"} py-stack-md hover:border-secondary transition-colors">
          <span class="material-symbols-outlined text-[28px]">${m.icon}</span>
          <span class="font-label-mono text-[12px] uppercase tracking-wide">${m.label}</span>
        </button>`;
    }).join("");
    box.querySelectorAll("[data-pay-method]").forEach((btn) =>
      btn.addEventListener("click", () => {
        this.paymentMethod = btn.dataset.payMethod;
        this.renderPaymentMethods();
      })
    );
  },

  renderShippingOptions() {
    const box = document.getElementById("shipping-options");
    if (!this.shippingMethods.length) {
      box.innerHTML = `<p class="font-label-mono text-[12px] text-error uppercase">No hay métodos de envío disponibles. Contacta con la tienda.</p>`;
      return;
    }
    const free = this.freeShipping();
    box.innerHTML = this.shippingMethods
      .map(
        (m) => `
        <label class="flex items-center justify-between gap-3 border ${m.id === this.selectedShippingId ? "border-secondary" : "border-outline-variant/20"} px-stack-md py-stack-sm cursor-pointer hover:border-secondary transition-colors">
          <span class="flex items-center gap-3 min-w-0">
            <input type="radio" name="shipping-method" value="${m.id}" ${m.id === this.selectedShippingId ? "checked" : ""}
              class="text-secondary focus:ring-0 bg-transparent border-outline-variant"/>
            <span class="min-w-0">
              <span class="font-label-mono text-[13px] text-on-surface uppercase block truncate">${ntEscapeHtml(m.name)}</span>
              ${m.description ? `<span class="font-body-md text-[13px] text-on-surface-variant block truncate">${ntEscapeHtml(m.description)}</span>` : ""}
            </span>
          </span>
          <span class="font-label-mono text-[13px] ${free ? "text-on-surface-variant line-through" : "text-secondary"} whitespace-nowrap">
            ${Number(m.price) === 0 ? "Gratis" : ntFormatMoney(m.price)}
          </span>
        </label>`
      )
      .join("");
    box.querySelectorAll("input[name=shipping-method]").forEach((radio) =>
      radio.addEventListener("change", () => {
        this.selectedShippingId = radio.value;
        this.renderShippingOptions();
        this.renderSummary();
      })
    );
  },

  renderSummary() {
    document.getElementById("order-items").innerHTML = this.cart.items
      .map(
        (item) => `
        <div class="flex gap-stack-sm items-center">
          <div class="w-14 h-16 bg-surface-container flex-shrink-0 border border-outline-variant/20 overflow-hidden">
            <img class="w-full h-full object-cover mix-blend-luminosity" src="${ntProductImage(item.product)}" alt="${ntEscapeHtml(item.product.name)}"/>
          </div>
          <div class="flex-grow min-w-0">
            <p class="font-label-mono text-[13px] text-on-surface uppercase truncate">${ntEscapeHtml(item.product.name)}</p>
            <p class="font-label-mono text-[11px] text-on-surface-variant">${item.product.productType === "TICKET_EVENTO" ? "Entrada general" : `Talla ${item.productVariant.size}`} · x${item.quantity}</p>
          </div>
          <span class="font-label-mono text-[13px] text-secondary whitespace-nowrap">${ntFormatMoney(Number(item.product.price) * item.quantity)}</span>
        </div>`
      )
      .join("");

    const subtotal = this.subtotal();
    const discount = this.discountAmount();
    const free = this.freeShipping();
    const shipping = this.shippingCost();
    const discountRow = this.cart.discountCode
      ? `<div class="flex justify-between items-center mb-stack-sm">
           <span class="font-label-mono text-label-mono text-secondary uppercase">Cupón ${ntEscapeHtml(this.cart.discountCode.code)}</span>
           <span class="font-label-mono text-label-mono text-secondary">${free ? "Envío gratis" : "-" + ntFormatMoney(discount)}</span>
         </div>`
      : "";

    document.getElementById("order-totals").innerHTML = `
      <div class="flex justify-between items-center mb-stack-sm">
        <span class="font-label-mono text-label-mono text-on-surface-variant uppercase">Subtotal</span>
        <span class="font-label-mono text-label-mono text-on-surface">${ntFormatMoney(subtotal)}</span>
      </div>
      ${discountRow}
      <div class="flex justify-between items-center mb-stack-sm">
        <span class="font-label-mono text-label-mono text-on-surface-variant uppercase">Envío</span>
        <span class="font-label-mono text-label-mono ${free ? "text-secondary" : "text-on-surface"}">${free ? "GRATIS" : shipping === 0 ? "Gratis" : ntFormatMoney(shipping)}</span>
      </div>
      <div class="flex justify-between items-center border-t border-outline-variant/30 pt-stack-sm mt-stack-sm">
        <span class="font-label-mono text-label-mono text-on-surface-variant uppercase">Total</span>
        <span class="font-headline-lg text-headline-lg-mobile text-on-surface">${ntFormatMoney(this.total())}</span>
      </div>`;

    const btn = document.getElementById("pay-btn");
    btn.textContent = `Pagar ${ntFormatMoney(this.total())}`;
  },

  // ---------- Envío del pedido ----------

  wire() {
    document.getElementById("checkout-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.pay();
    });
  },

  async pay() {
    const form = document.getElementById("checkout-form");
    if (!form.reportValidity()) return;
    if (!this.selectedShippingId) {
      ntToast("Elige un método de envío", true);
      return;
    }

    const email = document.getElementById("checkout-email").value.trim();
    const shippingAddress = {
      name: document.getElementById("ship-name").value.trim(),
      address: document.getElementById("ship-address").value.trim(),
      city: document.getElementById("ship-city").value.trim(),
      postalCode: document.getElementById("ship-postal").value.trim(),
      country: document.getElementById("ship-country").value.trim(),
      phone: document.getElementById("ship-phone").value.trim() || undefined,
    };

    const btn = document.getElementById("pay-btn");
    btn.disabled = true;
    btn.textContent = "Procesando...";
    try {
      const res = await ntApi("/checkout", {
        method: "POST",
        body: JSON.stringify({
          cartId: this.cartId(),
          email,
          currency: "eur",
          shippingMethodId: this.selectedShippingId,
          shippingAddress,
        }),
      });
      // El carrito pasa a CONVERTIDO en el backend: lo descartamos y refrescamos el badge.
      localStorage.removeItem(CO_CART_KEY);
      // NTCart vive en el scope global compartido (cart.js), no en window.
      if (typeof NTCart !== "undefined") NTCart.clear();
      await this.showConfirmation({ ...res, email });
    } catch (err) {
      ntToast(err.message, true);
      btn.disabled = false;
      this.renderSummary();
    }
  },

  async showConfirmation({ orderId, total, clientSecret, simulated, email }) {
    document.getElementById("checkout-view").classList.add("hidden");
    const view = document.getElementById("confirmation");
    view.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });

    document.getElementById("confirmation-order").textContent = orderId;
    document.getElementById("confirmation-total").textContent = ntFormatMoney(total);
    document.getElementById("confirmation-email").textContent = email;
    document.getElementById("confirmation-track").href =
      `track.html?order=${encodeURIComponent(orderId)}&email=${encodeURIComponent(email)}`;

    const sub = document.getElementById("confirmation-sub");
    const payHost = document.getElementById("confirmation-payment-host");

    if (simulated) {
      sub.textContent = "Tu pago se ha confirmado. Te enviaremos las novedades a tu correo.";
      payHost.innerHTML = `
        <p class="font-label-mono text-[11px] text-secondary uppercase leading-relaxed">
          Modo simulación (CHECKOUT_SKIP_STRIPE): pedido marcado como PAGADO automáticamente.
        </p>`;
      return;
    }

    if (clientSecret && window.NT_STRIPE_PK) {
      sub.textContent = "Completa el pago para finalizar tu pedido.";
      await this.mountStripe({ clientSecret, orderId, email, payHost });
      return;
    }

    sub.textContent = "Tu pedido se ha registrado y queda pendiente de pago.";
    payHost.innerHTML = `
      <p class="font-label-mono text-[11px] text-on-surface-variant uppercase leading-relaxed">
        Configura window.NT_STRIPE_PK con tu clave publicable de Stripe para completar el pago online.
      </p>`;
  },

  // Flujo real de Stripe (solo si hay clave publicable configurada).
  async mountStripe({ clientSecret, orderId, email, payHost }) {
    if (!window.Stripe) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://js.stripe.com/v3/";
        s.onload = resolve;
        s.onerror = () => reject(new Error("No se pudo cargar Stripe.js"));
        document.head.appendChild(s);
      });
    }
    const stripe = window.Stripe(window.NT_STRIPE_PK);
    const elements = stripe.elements({ clientSecret, appearance: { theme: "night" } });
    payHost.innerHTML = `
      <div id="payment-element"></div>
      <button id="stripe-pay" class="btn-primary mt-stack-md">Pagar ahora</button>
      <p id="stripe-error" class="font-label-mono text-[12px] text-error uppercase mt-2 hidden"></p>`;
    elements.create("payment").mount("#payment-element");

    document.getElementById("stripe-pay").addEventListener("click", async () => {
      const b = document.getElementById("stripe-pay");
      b.disabled = true;
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/track.html?order=${encodeURIComponent(orderId)}&email=${encodeURIComponent(email)}`,
        },
      });
      if (error) {
        const el = document.getElementById("stripe-error");
        el.textContent = error.message;
        el.classList.remove("hidden");
        b.disabled = false;
      }
    });
  },
};

document.addEventListener("DOMContentLoaded", () => Checkout.init());
