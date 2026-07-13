import { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "@/utils/AppError";
import { uploadImage } from "@/services/upload.service";

/**
 * Valida el tipo real de la imagen por sus "magic bytes", no por el content-type
 * declarado por el cliente (que es falsificable). Solo se aceptan formatos ráster
 * seguros; se rechaza SVG a propósito (puede contener scripts).
 */
function detectImageType(buffer: Buffer): "jpeg" | "png" | "gif" | "webp" | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png";
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return "gif";
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/**
 * POST /api/admin/uploads
 *
 * Recibe uno o varios archivos (multipart/form-data, campo "files"), valida que
 * sean imágenes reales, los sube a Cloudinary y devuelve las URLs resultantes.
 * El panel guarda esas URLs en el campo de imágenes del producto/artista/evento.
 */
export async function uploadImagesHandler(request: FastifyRequest, reply: FastifyReply) {
  const urls: string[] = [];

  for await (const part of request.files()) {
    const buffer = await part.toBuffer();
    // No nos fiamos del mimetype declarado: comprobamos los bytes reales.
    if (detectImageType(buffer) === null) {
      throw new AppError(`El archivo "${part.filename}" no es una imagen válida (JPEG/PNG/GIF/WebP)`, 415);
    }
    urls.push(await uploadImage(buffer));
  }

  if (urls.length === 0) {
    throw new AppError("No se recibió ningún archivo", 400);
  }

  return reply.send({ urls });
}
