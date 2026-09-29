import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/services/email.service";
import { OrderEmailData, orderConfirmationEmail, orderShippedEmail } from "@/services/email-templates";

type OrderEmailKind = "confirmation" | "shipped";

const TEMPLATES: Record<OrderEmailKind, (o: OrderEmailData) => { subject: string; html: string; text: string }> = {
  confirmation: orderConfirmationEmail,
  shipped: orderShippedEmail,
};

async function loadOrderForEmail(orderId: string): Promise<OrderEmailData | null> {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: { select: { name: true, productType: true } },
          productVariant: { select: { size: true } },
        },
      },
    },
  });
}

/**
 * Envía al comprador el email transaccional de un pedido. Se llama DESPUÉS de
 * confirmar la transacción de negocio y nunca lanza: si el correo falla, el
 * pedido sigue en su estado correcto y el fallo queda en el log.
 */
export async function notifyOrder(orderId: string, kind: OrderEmailKind): Promise<void> {
  try {
    const order = await loadOrderForEmail(orderId);
    if (!order) return;
    const email = TEMPLATES[kind](order);
    await sendEmail({ to: order.email, ...email });
  } catch (err) {
    logger.error({ err, orderId, kind }, "No se pudo preparar el email del pedido");
  }
}
