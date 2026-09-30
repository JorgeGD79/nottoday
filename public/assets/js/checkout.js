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
  // Presupuesto del servidor (POST /api/cart/:id/quote): líneas, IVA, cupón,
  // opciones de envío para el país y total. El navegador no calcula importes.
  quote: null,
  countries: { anyCountry: true, countries: [] },
  selectedShippingId: null,
  paymentMethod: "card",

  cartId() {
    return localStorage.getItem(CO_CART_KEY);
  },

  country() {
    return document.getElementById("ship-country").value || null;
  },

  requiresShipping() {
    return !!(this.cart && this.cart.items.some((i) => i.product.productType !== "TICKET_EVENTO"));
  },

  // ---------- Carga inicial ----------

  async init() {
    // Enlace del email de carrito abandonado: checkout.html?cart=<id>
    const fromLink = new URLSearchParams(window.location.search).get("cart");
    if (fromLink) {
      try {
        await ntApi(`/cart/${encodeURIComponent(fromLink)}/restore`, { method: "POST", body: "{}" });
        localStorage.setItem(CO_CART_KEY, fromLink);
        if (typeof NTCart !== "undefined") NTCart.load();
      } catch {
        /* carrito ya convertido o inexistente: se sigue con el que hubiera */
      }
      history.replaceState(null, "", window.location.pathname);
    }

    const id = this.cartId();
    if (!id) return this.showEmpty();
    try {
      const [{ cart }, countries] = await Promise.all([
        ntApi(`/cart/${id}`),
        ntApi("/shipping/countries").catch(() => ({ anyCountry: true, countries: [] })),
      ]);
      if (!cart || cart.status !== "ACTIVO" || cart.items.length === 0) return this.showEmpty();
      this.cart = cart;
      this.countries = countries;
      if (cart.email) document.getElementById("checkout-email").value = cart.email;
    } catch (err) {
      if (err.status === 404) localStorage.removeItem(CO_CART_KEY);
      return this.showEmpty();
    }

    document.getElementById("loading-state").classList.add("hidden");
    document.getElementById("checkout-view").classList.remove("hidden");
    this.renderCountries();
    this.toggleShippingSections();
    this.renderAttendees();
    this.renderPaymentMethods();
    this.wire();
    await this.refreshQuote();
  },

  showEmpty() {
    document.getElementById("loading-state").classList.add("hidden");
    document.getElementById("checkout-view").classList.add("hidden");
    document.getElementById("empty-state").classList.remove("hidden");
  },

  // Países del selector: los que tienen envío (o todos, si hay "resto del
  // mundo"/métodos sin zona, o si el pedido es solo de entradas).
  renderCountries() {
    const select = document.getElementById("ship-country");
    const all = !this.requiresShipping() || this.countries.anyCountry || !this.countries.countries.length;
    const codes = all ? NT_COUNTRY_CODES : this.countries.countries;
    const options = ntCountryOptions(codes);
    const preferred = codes.includes("ES") ? "ES" : options[0] && options[0][0];
    select.innerHTML = options
      .map(([code, name]) => `<option value="${code}" ${code === preferred ? "selected" : ""}>${ntEscapeHtml(name)}</option>`)
      .join("");
  },

  // Entradas nominativas: un campo de nombre por cada entrada del carrito.
  nominativeItems() {
    return this.cart.items.filter((i) => i.product.event && i.product.event.nominativeTickets);
  },

  renderAttendees() {
    const items = this.nominativeItems();
    document.getElementById("attendees-section").classList.toggle("hidden", !items.length);
    document.getElementById("attendees-fields").innerHTML = items.map((item) => `
      <fieldset class="space-y-2">
        <legend class="nt-label">${ntEscapeHtml(item.product.event.title)} · ${item.quantity} entrada${item.quantity === 1 ? "" : "s"}</legend>
        ${Array.from({ length: item.quantity }, (_, n) => `
          <input type="text" class="nt-input" data-attendee="${item.productVariantId}" required minlength="2" maxlength="120"
            placeholder="Asistente ${n + 1}: nombre y apellidos" aria-label="Asistente ${n + 1}" autocomplete="${n === 0 ? "name" : "off"}"/>`).join("")}
      </fieldset>`).join("");
  },

  attendees() {
    const out = {};
    document.querySelectorAll("[data-attendee]").forEach((input) => {
      (out[input.dataset.attendee] ||= []).push(input.value.trim());
    });
    return out;
  },

  toggleShippingSections() {
    const needs = this.requiresShipping();
    document.getElementById("ship-section").classList.toggle("hidden", !needs);
    document.getElementById("shipping-section").classList.toggle("hidden", !needs);
    // Sin envío, la dirección no es obligatoria (el navegador no la valida).
    document.querySelectorAll("#ship-section [required]").forEach((el) => { el.required = needs; });
  },

  async refreshQuote() {
    try {
      const { quote } = await ntApi(`/cart/${this.cartId()}/quote`, {
        method: "POST",
        body: JSON.stringify({ country: this.country() || undefined, shippingMethodId: this.selectedShippingId || undefined }),
      });
      this.quote = quote;
      // Si el método elegido ya no vale para el nuevo país/peso, se elige el primero.
      if (quote.requiresShipping && !quote.shippingMethod && quote.shippingOptions.length) {
        this.selectedShippingId = quote.shippingOptions[0].id;
        return this.refreshQuote();
      }
      if (!quote.shippingMethod) this.selectedShippingId = null;
    } catch (err) {
      ntToast(err.message, true);
    }
    this.renderShippingOptions();
    this.renderSummary();
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
    const q = this.quote;
    if (!q || !q.requiresShipping) { box.innerHTML = ""; return; }
    if (!q.shippingOptions.length) {
      box.innerHTML = `<p class="font-label-mono text-[12px] text-error uppercase">No hacemos envíos a ${ntEscapeHtml(ntCountryName(q.country))} con este pedido. Prueba otro país o escríbenos.</p>`;
      return;
    }
    const kg = q.weightGrams > 0 ? ` · ${(q.weightGrams / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} kg` : "";
    box.innerHTML = q.shippingOptions
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
          <span class="font-label-mono text-[13px] text-secondary whitespace-nowrap">
            ${m.cost === 0 ? "Gratis" : ntFormatMoney(m.cost)}
          </span>
        </label>`
      )
      .join("") + `<p class="font-label-mono text-[10px] text-on-surface-variant uppercase tracking-wide">Envío a ${ntEscapeHtml(ntCountryName(q.country))}${kg}</p>`;
    box.querySelectorAll("input[name=shipping-method]").forEach((radio) =>
      radio.addEventListener("change", () => {
        this.selectedShippingId = radio.value;
        this.refreshQuote();
      })
    );
  },

  renderSummary() {
    const q = this.quote;
    const lines = q ? q.lines : [];
    const imageFor = (productVariantId) => {
      const item = this.cart.items.find((i) => i.productVariantId === productVariantId);
      return item ? ntProductImage(item.product) : ntPlaceholderImage("NT");
    };
    document.getElementById("order-items").innerHTML = lines
      .map(
        (line) => `
        <div class="flex gap-stack-sm items-center">
          <div class="w-14 h-16 bg-surface-container flex-shrink-0 border border-outline-variant/20 overflow-hidden">
            <img class="w-full h-full object-cover mix-blend-luminosity" src="${imageFor(line.productVariantId)}" alt="${ntEscapeHtml(line.name)}"/>
          </div>
          <div class="flex-grow min-w-0">
            <p class="font-label-mono text-[13px] text-on-surface uppercase truncate">${ntEscapeHtml(line.name)}</p>
            <p class="font-label-mono text-[11px] text-on-surface-variant">${ntEscapeHtml(line.variantLabel)} · x${line.quantity}</p>
          </div>
          <span class="font-label-mono text-[13px] text-secondary whitespace-nowrap">${ntFormatMoney(line.lineTotal)}</span>
        </div>`
      )
      .join("");

    if (!q) {
      document.getElementById("order-totals").innerHTML = "";
      return;
    }
    const discountRow = q.discount
      ? `<div class="flex justify-between items-center mb-stack-sm">
           <span class="font-label-mono text-label-mono text-secondary uppercase">Cupón ${ntEscapeHtml(q.discount.code)}</span>
           <span class="font-label-mono text-label-mono text-secondary">${q.discount.freeShipping ? "Envío gratis" : "-" + ntFormatMoney(q.discount.amount)}</span>
         </div>`
      : q.discountError
        ? `<p class="font-label-mono text-[11px] text-error uppercase mb-stack-sm">Cupón no aplicado: ${ntEscapeHtml(q.discountError)}</p>`
        : "";
    const shippingRow = q.requiresShipping
      ? `<div class="flex justify-between items-center mb-stack-sm">
           <span class="font-label-mono text-label-mono text-on-surface-variant uppercase">Envío</span>
           <span class="font-label-mono text-label-mono text-on-surface">${!q.shippingMethod ? "—" : q.shippingCost === 0 ? "Gratis" : ntFormatMoney(q.shippingCost)}</span>
         </div>`
      : "";
    const taxNote = q.taxExempt
      ? `Productos sin IVA (exportación)${q.taxAmount > 0 ? ` · IVA de entradas incluido: ${ntFormatMoney(q.taxAmount)}` : ""}`
      : `IVA incluido: ${ntFormatMoney(q.taxAmount)}`;

    document.getElementById("order-totals").innerHTML = `
      <div class="flex justify-between items-center mb-stack-sm">
        <span class="font-label-mono text-label-mono text-on-surface-variant uppercase">Subtotal</span>
        <span class="font-label-mono text-label-mono text-on-surface">${ntFormatMoney(q.subtotal)}</span>
      </div>
      ${discountRow}
      ${shippingRow}
      <div class="flex justify-between items-center border-t border-outline-variant/30 pt-stack-sm mt-stack-sm">
        <span class="font-label-mono text-label-mono text-on-surface-variant uppercase">Total</span>
        <span class="font-headline-lg text-headline-lg-mobile text-on-surface">${ntFormatMoney(q.total)}</span>
      </div>
      <p class="font-label-mono text-[10px] text-on-surface-variant uppercase tracking-wide mt-1 text-right">${taxNote}</p>`;

    const btn = document.getElementById("pay-btn");
    btn.textContent = `Pagar ${ntFormatMoney(q.total)}`;
  },

  // ---------- Envío del pedido ----------

  wire() {
    document.getElementById("checkout-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.pay();
    });
    document.getElementById("ship-country").addEventListener("change", () => this.refreshQuote());
    document.getElementById("want-invoice").addEventListener("change", (e) => {
      document.getElementById("invoice-fields").classList.toggle("hidden", !e.target.checked);
    });
    // Guardamos el email en el carrito en cuanto se escribe: si la compra se
    // queda a medias, podemos enviarle UN recordatorio con su carrito.
    document.getElementById("checkout-email").addEventListener("change", (e) => {
      const email = e.target.value.trim();
      if (!/.+@.+\..+/.test(email) || !this.cartId()) return;
      ntApi(`/cart/${this.cartId()}/email`, { method: "PATCH", body: JSON.stringify({ email }) }).catch(() => {});
    });
  },

  async pay() {
    const form = document.getElementById("checkout-form");
    if (!form.reportValidity()) return;
    const needsShipping = this.requiresShipping();
    if (needsShipping && !this.selectedShippingId) {
      ntToast("Elige un método de envío", true);
      return;
    }

    const email = document.getElementById("checkout-email").value.trim();
    const country = this.country();
    const body = { cartId: this.cartId(), email, currency: "eur" };
    if (needsShipping) {
      body.shippingMethodId = this.selectedShippingId;
      body.shippingAddress = {
        name: document.getElementById("ship-name").value.trim(),
        address: document.getElementById("ship-address").value.trim(),
        city: document.getElementById("ship-city").value.trim(),
        postalCode: document.getElementById("ship-postal").value.trim(),
        country,
        phone: document.getElementById("ship-phone").value.trim() || undefined,
      };
    } else if (country) {
      body.billingCountry = country;
    }
    if (this.nominativeItems().length) body.attendees = this.attendees();
    if (document.getElementById("want-invoice").checked) {
      body.billing = {
        name: document.getElementById("bill-name").value.trim() || undefined,
        taxId: document.getElementById("bill-taxid").value.trim() || undefined,
      };
    }

    const btn = document.getElementById("pay-btn");
    btn.disabled = true;
    btn.textContent = "Procesando...";
    try {
      const res = await ntApi("/checkout", { method: "POST", body: JSON.stringify(body) });
      // El carrito pasa a CONVERTIDO en el backend: lo descartamos y refrescamos el badge.
      localStorage.removeItem(CO_CART_KEY);
      // NTCart vive en el scope global compartido (cart.js), no en window.
      if (typeof NTCart !== "undefined") NTCart.clear();
      await this.showConfirmation({ ...res, email });
    } catch (err) {
      ntToast(err.message, true);
      btn.disabled = false;
      this.refreshQuote();
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
      sub.textContent = "Tu pago se ha confirmado. Tienes el pedido, la factura y tus entradas en el seguimiento.";
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
