import { env } from "@/config/env";

// ============================================================================
// Plantillas de email transaccional. HTML con estilos inline (los clientes de
// correo ignoran <style> y CSS externo) + versión en texto plano.
// ============================================================================

const BRAND = "NOT TODAY";
const ACCENT = "#ff8a00";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const money = (value: unknown) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(value));

export const trackUrl = (orderId: string, email: string) =>
  `${env.APP_URL}/track.html?order=${encodeURIComponent(orderId)}&email=${encodeURIComponent(email)}`;


function button(href: string, label: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${ACCENT};color:#050505;text-decoration:none;font-weight:bold;text-transform:uppercase;letter-spacing:1px;padding:14px 24px;font-family:Arial,sans-serif;font-size:13px;">${escapeHtml(label)}</a>`;
}

function layout(title: string, bodyHtml: string, footerHtml = "") {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#050505;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#131313;border:1px solid #353535;">
        <tr><td style="padding:24px 28px;border-bottom:1px solid #353535;font-family:Arial,sans-serif;font-weight:900;font-size:20px;letter-spacing:2px;color:#e5e2e1;">
          ${BRAND}<span style="color:${ACCENT};">.</span>
        </td></tr>
        <tr><td style="padding:28px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#c4c7c8;">
          <h1 style="margin:0 0 16px;font-size:26px;line-height:1.1;text-transform:uppercase;color:#e5e2e1;">${escapeHtml(title)}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:20px 28px;border-top:1px solid #353535;font-family:Arial,sans-serif;font-size:11px;color:#8e9192;">
          ${footerHtml || `${BRAND} Collective · <a href="${env.APP_URL}" style="color:#8e9192;">${escapeHtml(env.APP_URL.replace(/^https?:\/\//, ""))}</a>`}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// --------------------------------------------------------------------------
// Tipos de entrada (subconjunto de Prisma que necesitan las plantillas)
// --------------------------------------------------------------------------

export interface OrderEmailData {
  id: string;
  email: string;
  subtotal: unknown;
  discountAmount: unknown;
  shippingCost: unknown;
  total: unknown;
  shippingMethodName: string | null;
  shippingName: string | null;
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingPostalCode: string | null;
  shippingCountry: string | null;
  trackingCode: string | null;
  items: {
    quantity: number;
    unitPrice: unknown;
    product: { name: string; productType: string };
    productVariant: { size: string };
  }[];
}

function itemsTable(order: OrderEmailData) {
  const rows = order.items
    .map((i) => {
      const size = i.product.productType === "TICKET_EVENTO" ? "" : ` (${i.productVariant.size})`;
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #353535;color:#e5e2e1;">${i.quantity}x ${escapeHtml(i.product.name)}${escapeHtml(size)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #353535;text-align:right;white-space:nowrap;">${money(Number(i.unitPrice) * i.quantity)}</td>
      </tr>`;
    })
    .join("");
  const discount = Number(order.discountAmount) > 0
    ? `<tr><td style="padding:4px 0;color:${ACCENT};">Descuento</td><td style="padding:4px 0;text-align:right;color:${ACCENT};">-${money(order.discountAmount)}</td></tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:16px 0;">
    ${rows}
    <tr><td style="padding:8px 0 4px;">Subtotal</td><td style="padding:8px 0 4px;text-align:right;">${money(order.subtotal)}</td></tr>
    ${discount}
    <tr><td style="padding:4px 0;">Envío${order.shippingMethodName ? ` · ${escapeHtml(order.shippingMethodName)}` : ""}</td><td style="padding:4px 0;text-align:right;">${Number(order.shippingCost) === 0 ? "Gratis" : money(order.shippingCost)}</td></tr>
    <tr><td style="padding:8px 0;border-top:1px solid #353535;color:#e5e2e1;font-weight:bold;">Total</td><td style="padding:8px 0;border-top:1px solid #353535;text-align:right;color:#e5e2e1;font-weight:bold;">${money(order.total)}</td></tr>
  </table>`;
}

function itemsText(order: OrderEmailData) {
  return [
    ...order.items.map((i) =>
      `${i.quantity}x ${i.product.name}${i.product.productType === "TICKET_EVENTO" ? "" : ` (${i.productVariant.size})`} — ${money(Number(i.unitPrice) * i.quantity)}`),
    `Total: ${money(order.total)}`,
  ].join("\n");
}

// --------------------------------------------------------------------------
// Plantillas
// --------------------------------------------------------------------------

export function orderConfirmationEmail(order: OrderEmailData) {
  const hasPhysical = order.items.some((i) => i.product.productType !== "TICKET_EVENTO");
  const address = hasPhysical && order.shippingAddress
    ? `<p style="margin:16px 0 0;"><strong style="color:#e5e2e1;">Envío a:</strong><br>${escapeHtml(order.shippingName)}<br>${escapeHtml(order.shippingAddress)}<br>${escapeHtml([order.shippingPostalCode, order.shippingCity, order.shippingCountry].filter(Boolean).join(", "))}</p>`
    : "";
  const html = layout(
    "Pedido confirmado",
    `<p style="margin:0;">Hemos recibido tu pago. Gracias por apoyar al colectivo.</p>
     <p style="margin:8px 0 0;font-family:monospace;font-size:12px;color:#8e9192;">Pedido ${escapeHtml(order.id)}</p>
     ${itemsTable(order)}
     ${address}
     <p style="margin:24px 0 0;">${button(trackUrl(order.id, order.email), "Seguir mi pedido")}</p>`
  );
  const text = `Pedido confirmado (${order.id})\n\n${itemsText(order)}\n\nSeguimiento: ${trackUrl(order.id, order.email)}`;
  return { subject: `Pedido confirmado · ${BRAND}`, html, text };
}

export function orderShippedEmail(order: OrderEmailData) {
  const tracking = order.trackingCode
    ? `<p style="margin:16px 0 0;">Código de seguimiento${order.shippingMethodName ? ` (${escapeHtml(order.shippingMethodName)})` : ""}:<br><span style="font-family:monospace;font-size:16px;color:${ACCENT};">${escapeHtml(order.trackingCode)}</span></p>`
    : "";
  const html = layout(
    "Tu pedido va en camino",
    `<p style="margin:0;">Tu pedido ya ha salido de nuestras manos.</p>
     <p style="margin:8px 0 0;font-family:monospace;font-size:12px;color:#8e9192;">Pedido ${escapeHtml(order.id)}</p>
     ${tracking}
     ${itemsTable(order)}
     <p style="margin:24px 0 0;">${button(trackUrl(order.id, order.email), "Seguir mi pedido")}</p>`
  );
  const text = `Tu pedido ${order.id} va en camino.${order.trackingCode ? `\nTracking: ${order.trackingCode}` : ""}\n\n${itemsText(order)}\n\nSeguimiento: ${trackUrl(order.id, order.email)}`;
  return { subject: `Pedido enviado · ${BRAND}`, html, text };
}

export function bookingReceivedEmail(booking: { type: string; requesterName: string; email: string; details: string }) {
  const label = booking.type === "CONTRATACION" ? "Booking" : "Colaboración";
  const html = layout(
    `Nueva solicitud: ${label}`,
    `<p style="margin:0;"><strong style="color:#e5e2e1;">${escapeHtml(booking.requesterName)}</strong> &lt;${escapeHtml(booking.email)}&gt;</p>
     <p style="margin:16px 0 0;white-space:pre-line;">${escapeHtml(booking.details)}</p>
     <p style="margin:24px 0 0;">${button(`${env.APP_URL}/admin.html#bookings`, "Abrir en el panel")}</p>`
  );
  const text = `Nueva solicitud (${label}) de ${booking.requesterName} <${booking.email}>\n\n${booking.details}`;
  return { subject: `Nueva solicitud de ${label.toLowerCase()}: ${booking.requesterName}`, html, text };
}
