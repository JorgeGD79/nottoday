import { FastifyReply, FastifyRequest } from "fastify";
import Stripe from "stripe";
import { checkoutSchema } from "./checkout.schema";
import { checkout, markOrderAsPaid, releaseOrderStock } from "./checkout.service";
import { stripe } from "@/services/stripe.service";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";

/**
 * POST /api/checkout
 *
 * Recibe un carrito ya validado (con o sin descuento aplicado), reserva el
 * stock por talla bajo bloqueo transaccional (ver checkout.service.ts) y
 * devuelve el `clientSecret` del PaymentIntent de Stripe para que el
 * frontend complete el pago con el Payment Element / Payment Request Button
 * (tarjeta, Apple Pay o Google Pay indistintamente).
 */
export async function checkoutHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = checkoutSchema.parse(request.body);
  const { order, clientSecret, simulated } = await checkout(input);

  return reply.code(201).send({
    orderId: order.id,
    total: order.total,
    shippingCost: order.shippingCost,
    shippingMethodName: order.shippingMethodName,
    clientSecret,
    // true cuando el pago se ha simulado (CHECKOUT_SKIP_STRIPE): el pedido ya
    // está PAGADO y no hay que montar el Payment Element.
    simulated,
  });
}

/**
 * POST /api/checkout/webhook
 *
 * Fuente de verdad final del estado del pago. Nunca confirmamos un pedido
 * como pagado desde el frontend: solo este webhook, verificado con la firma
 * secreta de Stripe, puede mover un pedido a PAGADO o liberar el stock
 * reservado si el pago falla o expira.
 */
export async function stripeWebhookHandler(request: FastifyRequest, reply: FastifyReply) {
  const signature = request.headers["stripe-signature"];
  if (!signature || typeof signature !== "string" || !env.STRIPE_WEBHOOK_SECRET) {
    throw AppError.unauthorized("Firma de webhook ausente o no configurada");
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(request.rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    request.log.warn({ err }, "Firma de webhook de Stripe inválida");
    throw AppError.unauthorized("Firma de webhook inválida");
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const orderId = intent.metadata.orderId;
      if (orderId) await markOrderAsPaid(orderId);
      break;
    }
    case "payment_intent.payment_failed":
    case "payment_intent.canceled": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const orderId = intent.metadata.orderId;
      if (orderId) await releaseOrderStock(orderId);
      break;
    }
    default:
      request.log.debug({ type: event.type }, "Evento de Stripe no gestionado");
  }

  return reply.code(200).send({ received: true });
}
