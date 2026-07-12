import { z } from "zod";
import { BookingType } from "@prisma/client";

export const createBookingSchema = z.object({
  type: z.nativeEnum(BookingType),
  requesterName: z.string().min(2).max(150),
  email: z.string().email(),
  details: z.string().min(10).max(3000),
  artistId: z.string().cuid().optional(),
});
