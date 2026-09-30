import { z } from "zod";
import { BookingType } from "@prisma/client";

// Solo propuestas de colaboración: la contratación de artistas la lleva el
// management de cada uno y ya no entra por la web. El tipo CONTRATACION sigue
// en la base de datos para conservar las solicitudes antiguas.
export const createBookingSchema = z.object({
  type: z.literal(BookingType.COLABORACION, {
    errorMap: () => ({ message: "Para contratar a un artista, contacta con su management" }),
  }),
  requesterName: z.string().min(2).max(150),
  email: z.string().email(),
  details: z.string().min(10).max(3000),
});
