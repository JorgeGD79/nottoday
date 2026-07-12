import { v2 as cloudinary } from "cloudinary";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";

let configured = false;

// Configuramos Cloudinary de forma perezosa (solo la primera vez que se sube algo).
// Así el servidor arranca aunque no haya credenciales; solo falla la subida.
function ensureConfigured() {
  if (configured) return;
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new AppError(
      "La subida de imágenes no está configurada (faltan credenciales de Cloudinary).",
      503
    );
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

/**
 * Sube un buffer de imagen a Cloudinary y devuelve la URL segura (https, servida
 * por su CDN). Usamos upload_stream para no tener que escribir el archivo a disco.
 */
export async function uploadImage(buffer: Buffer, folder = "nottoday"): Promise<string> {
  ensureConfigured();

  return new Promise<string>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error || !result) {
          return reject(new AppError("No se pudo subir la imagen", 502, error?.message));
        }
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}
