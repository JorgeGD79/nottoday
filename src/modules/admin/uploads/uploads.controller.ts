import { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "@/utils/AppError";
import { uploadImage } from "@/services/upload.service";

/**
 * POST /api/admin/uploads
 *
 * Recibe uno o varios archivos (multipart/form-data, campo "files"), los sube a
 * Cloudinary y devuelve las URLs resultantes. El panel guarda esas URLs en el
 * campo de imágenes del producto/artista/evento.
 */
export async function uploadImagesHandler(request: FastifyRequest, reply: FastifyReply) {
  const urls: string[] = [];

  for await (const part of request.files()) {
    if (!part.mimetype.startsWith("image/")) {
      throw new AppError(`El archivo "${part.filename}" no es una imagen`, 415);
    }
    const buffer = await part.toBuffer();
    urls.push(await uploadImage(buffer));
  }

  if (urls.length === 0) {
    throw new AppError("No se recibió ningún archivo", 400);
  }

  return reply.send({ urls });
}
