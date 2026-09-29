import PDFDocument from "pdfkit";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";
import { includedTax } from "@/services/pricing.service";
import { round2 } from "@/services/shipping.service";

// ============================================================================
// Facturación. Cada pedido pagado recibe un número correlativo de la serie
// del año ("F2026-000001"); cada reembolso de un pedido facturado, una factura
// rectificativa de su propia serie ("R2026-000001"). La numeración es sin
// huecos porque se asigna dentro de la transacción que confirma el pago.
// ============================================================================

const madridYear = (d: Date) =>
  new Intl.DateTimeFormat("en", { timeZone: "Europe/Madrid", year: "numeric" }).format(d);

async function nextNumber(tx: Prisma.TransactionClient, series: "F" | "R", date: Date) {
  const id = `${series}${madridYear(date)}`;
  // UPSERT atómico: dos pagos simultáneos nunca obtienen el mismo número.
  const [row] = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "InvoiceCounter" ("id", "last") VALUES (${id}, 1)
    ON CONFLICT ("id") DO UPDATE SET "last" = "InvoiceCounter"."last" + 1
    RETURNING "last"
  `;
  return `${id}-${String(row.last).padStart(6, "0")}`;
}

/** Asigna el número de factura al pedido (idempotente: si ya tiene, no hace nada). */
export async function assignInvoiceNumber(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { invoiceNumber: true } });
  if (order.invoiceNumber) return order.invoiceNumber;
  const now = new Date();
  const invoiceNumber = await nextNumber(tx, "F", now);
  await tx.order.update({ where: { id: orderId }, data: { invoiceNumber, invoiceDate: now } });
  return invoiceNumber;
}

/** Factura rectificativa de un pedido facturado que se reembolsa. */
export async function assignCreditNoteNumber(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { invoiceNumber: true, creditNoteNumber: true },
  });
  if (!order.invoiceNumber || order.creditNoteNumber) return order.creditNoteNumber;
  const now = new Date();
  const creditNoteNumber = await nextNumber(tx, "R", now);
  await tx.order.update({ where: { id: orderId }, data: { creditNoteNumber, creditNoteDate: now } });
  return creditNoteNumber;
}

// --------------------------------------------------------------------------
// PDF
// --------------------------------------------------------------------------

const invoiceInclude = {
  items: { include: { product: { select: { name: true } } } },
} satisfies Prisma.OrderInclude;
type InvoiceOrder = Prisma.OrderGetPayload<{ include: typeof invoiceInclude }>;

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
const esDate = (d: Date) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
const countryName = (code: string | null) => {
  if (!code) return "";
  if (!/^[A-Z]{2}$/.test(code)) return code; // pedidos antiguos con país en texto libre
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

interface InvoiceRow {
  concept: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  amount: number; // importe de la línea con IVA incluido
}

function invoiceRows(order: InvoiceOrder): InvoiceRow[] {
  const rows: InvoiceRow[] = order.items.map((i) => ({
    concept: i.variantLabel ? `${i.product.name} (${i.variantLabel})` : i.product.name,
    quantity: i.quantity,
    unitPrice: Number(i.unitPrice),
    taxRate: Number(i.taxRate),
    amount: round2(Number(i.unitPrice) * i.quantity),
  }));
  if (Number(order.shippingCost) > 0) {
    rows.push({
      concept: `Envío${order.shippingMethodName ? ` · ${order.shippingMethodName}` : ""}`,
      quantity: 1,
      unitPrice: Number(order.shippingCost),
      taxRate: Number(order.shippingTaxRate),
      amount: Number(order.shippingCost),
    });
  }
  return rows;
}

/** Desglose por tipo: base imponible y cuota, ya con el cupón prorrateado. */
function taxBreakdown(order: InvoiceOrder) {
  const byRate = new Map<number, number>();
  for (const i of order.items) {
    const gross = Number(i.unitPrice) * i.quantity - Number(i.discountAmount);
    byRate.set(Number(i.taxRate), (byRate.get(Number(i.taxRate)) ?? 0) + gross);
  }
  if (Number(order.shippingCost) > 0) {
    const r = Number(order.shippingTaxRate);
    byRate.set(r, (byRate.get(r) ?? 0) + Number(order.shippingCost));
  }
  return [...byRate.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rate, gross]) => {
      const tax = includedTax(gross, rate);
      return { rate, base: round2(gross - tax), tax };
    });
}

function renderPdf(order: InvoiceOrder, kind: "invoice" | "credit-note"): Promise<Buffer> {
  const credit = kind === "credit-note";
  const sign = credit ? -1 : 1;
  const number = credit ? order.creditNoteNumber! : order.invoiceNumber!;
  const date = (credit ? order.creditNoteDate : order.invoiceDate) ?? order.createdAt;
  const simplified = !order.billingTaxId;
  const title = credit
    ? "FACTURA RECTIFICATIVA"
    : simplified ? "FACTURA SIMPLIFICADA" : "FACTURA";

  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `${title} ${number}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = 50;
  const right = doc.page.width - 50;
  const width = right - left;

  // --- Cabecera ---
  doc.font("Helvetica-Bold").fontSize(18).text(env.COMPANY_NAME, left, 50);
  doc.font("Helvetica").fontSize(9).fillColor("#444")
    .text(`NIF: ${env.COMPANY_TAX_ID}`)
    .text(env.COMPANY_ADDRESS)
    .text(env.COMPANY_EMAIL || "");
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(14).text(title, left, 50, { width, align: "right" });
  doc.font("Helvetica").fontSize(10)
    .text(`Nº ${number}`, { width, align: "right" })
    .text(`Fecha: ${esDate(date)}`, { width, align: "right" })
    .text(`Pedido: ${order.id}`, { width, align: "right" });
  if (credit) {
    doc.text(`Rectifica la factura ${order.invoiceNumber} (${order.invoiceDate ? esDate(order.invoiceDate) : ""})`, { width, align: "right" });
    doc.text("Motivo: devolución / anulación del pedido", { width, align: "right" });
  }

  // --- Cliente ---
  doc.moveDown(2);
  const clientY = Math.max(doc.y, 150);
  doc.font("Helvetica-Bold").fontSize(10).text("Cliente", left, clientY);
  doc.font("Helvetica").fontSize(10);
  const clientLines = [
    order.billingName || order.shippingName || "",
    order.billingTaxId ? `NIF/VAT: ${order.billingTaxId}` : "",
    order.shippingAddress || "",
    [order.shippingPostalCode, order.shippingCity].filter(Boolean).join(" "),
    countryName(order.shippingCountry),
    order.email,
  ].filter(Boolean);
  clientLines.forEach((l) => doc.text(l));

  // --- Líneas ---
  doc.moveDown(1.5);
  const cols = { concept: left, qty: left + 270, unit: left + 310, tax: left + 385, amount: left + 430 };
  const header = (y: number) => {
    doc.font("Helvetica-Bold").fontSize(9)
      .text("Concepto", cols.concept, y)
      .text("Uds.", cols.qty, y, { width: 35, align: "right" })
      .text("Precio", cols.unit, y, { width: 70, align: "right" })
      .text("IVA", cols.tax, y, { width: 40, align: "right" })
      .text("Importe", cols.amount, y, { width: right - cols.amount, align: "right" });
    doc.moveTo(left, y + 13).lineTo(right, y + 13).strokeColor("#999").stroke();
    return y + 18;
  };
  let y = header(doc.y);
  doc.font("Helvetica").fontSize(9);
  for (const row of invoiceRows(order)) {
    const h = doc.heightOfString(row.concept, { width: 260 });
    if (y + h > doc.page.height - 180) {
      doc.addPage();
      y = header(50);
      doc.font("Helvetica").fontSize(9);
    }
    doc.text(row.concept, cols.concept, y, { width: 260 })
      .text(String(sign * row.quantity), cols.qty, y, { width: 35, align: "right" })
      .text(eur(row.unitPrice), cols.unit, y, { width: 70, align: "right" })
      .text(`${row.taxRate}%`, cols.tax, y, { width: 40, align: "right" })
      .text(eur(sign * row.amount), cols.amount, y, { width: right - cols.amount, align: "right" });
    y += Math.max(h, 12) + 4;
  }
  if (Number(order.discountAmount) > 0) {
    doc.text("Descuento (cupón)", cols.concept, y, { width: 260 })
      .text(eur(-sign * Number(order.discountAmount)), cols.amount, y, { width: right - cols.amount, align: "right" });
    y += 16;
  }
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#999").stroke();
  y += 10;

  // --- Desglose de IVA y total ---
  const labelX = left + 250;
  const valueW = right - labelX;
  doc.font("Helvetica-Bold").fontSize(9).text("Base imponible", labelX, y, { width: 100 })
    .text("Tipo", labelX + 100, y, { width: 40, align: "right" })
    .text("Cuota", labelX + 140, y, { width: valueW - 140, align: "right" });
  y += 14;
  doc.font("Helvetica");
  for (const b of taxBreakdown(order)) {
    doc.text(eur(sign * b.base), labelX, y, { width: 100 })
      .text(`${b.rate}%`, labelX + 100, y, { width: 40, align: "right" })
      .text(eur(sign * b.tax), labelX + 140, y, { width: valueW - 140, align: "right" });
    y += 13;
  }
  y += 6;
  doc.font("Helvetica-Bold").fontSize(12)
    .text("TOTAL", labelX, y, { width: 100 })
    .text(eur(sign * Number(order.total)), labelX + 100, y, { width: valueW - 100, align: "right" });
  y += 20;
  doc.font("Helvetica").fontSize(8).fillColor("#444");
  if (order.taxExempt) {
    doc.text(
      "Entrega de bienes exenta de IVA: exportación fuera de la UE (art. 21 Ley 37/1992). Las entradas a eventos en España tributan igualmente.",
      left, y, { width }
    );
    y = doc.y + 4;
  }
  if (!credit) doc.text("Precios con IVA incluido.", left, y, { width });

  doc.end();
  return done;
}

async function loadForInvoice(orderId: string, email?: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...(email ? { email: { equals: email.trim(), mode: "insensitive" } } : {}) },
    include: invoiceInclude,
  });
  if (!order) throw AppError.notFound("Pedido");
  return order;
}

/** PDF de la factura. `email`: control de acceso del enlace público (id + email). */
export async function invoicePdf(orderId: string, email?: string) {
  const order = await loadForInvoice(orderId, email);
  if (!order.invoiceNumber) throw new AppError("Este pedido no tiene factura (no se ha pagado)", 404);
  return { filename: `factura-${order.invoiceNumber}.pdf`, pdf: await renderPdf(order, "invoice") };
}

export async function creditNotePdf(orderId: string, email?: string) {
  const order = await loadForInvoice(orderId, email);
  if (!order.creditNoteNumber) throw new AppError("Este pedido no tiene factura rectificativa", 404);
  return { filename: `rectificativa-${order.creditNoteNumber}.pdf`, pdf: await renderPdf(order, "credit-note") };
}
