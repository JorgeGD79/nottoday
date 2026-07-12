import Stripe from "stripe";
import { env } from "@/config/env";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

/**
 * Crea un PaymentIntent con `automatic_payment_methods` habilitado.
 * Esto es suficiente para que Stripe ofrezca Apple Pay / Google Pay de forma
 * automática a través del Payment Request Button / Payment Element en el
 * frontend, sin lógica adicional en el backend (Stripe detecta el dispositivo
 * y wallet disponibles en el navegador del comprador).
 */
export async function createPaymentIntent(params: {
  amount: number; // en la unidad menor de la divisa (céntimos)
  currency: string;
  orderId: string;
  receiptEmail?: string;
}) {
  return stripe.paymentIntents.create({
    amount: params.amount,
    currency: params.currency,
    receipt_email: params.receiptEmail,
    metadata: { orderId: params.orderId },
    automatic_payment_methods: { enabled: true },
  });
}

export function toStripeAmount(decimalAmount: number): number {
  return Math.round(decimalAmount * 100);
}
