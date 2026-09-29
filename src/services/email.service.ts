import { env } from "@/config/env";
import { logger } from "@/lib/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/**
 * Envía un email transaccional por la API HTTP de Resend (sin SDK: basta un fetch).
 *
 * Nunca lanza: un fallo de email no debe tumbar la operación de negocio que lo
 * origina (un pago confirmado sigue confirmado aunque el correo no salga). Los
 * fallos quedan en el log. Con EMAILS_ENABLED=false o sin RESEND_API_KEY solo se
 * registra el envío.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  if (!env.EMAILS_ENABLED) {
    logger.info({ to: message.to, subject: message.subject }, "Email no enviado (EMAILS_ENABLED=false)");
    return false;
  }
  if (!env.RESEND_API_KEY) {
    logger.info({ to: message.to, subject: message.subject }, "Email no enviado (RESEND_API_KEY sin configurar)");
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        reply_to: env.EMAIL_REPLY_TO,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error({ status: res.status, body, to: message.to, subject: message.subject }, "Resend rechazó el email");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, to: message.to, subject: message.subject }, "No se pudo enviar el email");
    return false;
  }
}
