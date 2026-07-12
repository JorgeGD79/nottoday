import { FastifyReply, FastifyRequest } from "fastify";
import {
  createProductSchema,
  productIdParamsSchema,
  updateProductSchema,
} from "./products.schema";
import {
  createProductWithInventory,
  deleteProduct,
  listProductsAdmin,
  updateProductWithInventory,
} from "./products.service";
import { recordAuditLog } from "@/services/audit-log.service";
import { invalidateCatalogCache } from "@/services/cache.service";

export async function listProductsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const products = await listProductsAdmin();
  return reply.send({ products });
}

/**
 * POST /api/admin/products
 *
 * Crea un producto y, en la MISMA operación, su inventario por talla
 * (S/M/L/XL con stock inicial) y, si el admin lo marca como DROP_EXCLUSIVO,
 * la configuración de la cuenta atrás (fecha/hora de lanzamiento + estado).
 *
 * Requiere rol ADMIN o STAFF (ver rutas). Cada creación queda registrada
 * en la tabla AuditLog con el usuario, la IP y un resumen de lo creado.
 */
export async function createProductHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createProductSchema.parse(request.body);

  const product = await createProductWithInventory(input);

  // Invalidamos el cache de catálogo público: un producto nuevo (sobre todo
  // un drop) debe reflejarse de inmediato en GET /api/shop y /api/drops.
  await invalidateCatalogCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Creó producto "${product.name}" (${product.productType}) con ${product.variants.length} talla(s)`,
    request,
    metadata: {
      productId: product.id,
      productType: product.productType,
      sizes: product.variants.map((v) => ({ size: v.size, stock: v.stockAvailable })),
    },
  });

  return reply.code(201).send({ product });
}

export async function updateProductHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = productIdParamsSchema.parse(request.params);
  const input = updateProductSchema.parse(request.body);

  const product = await updateProductWithInventory(id, input);
  await invalidateCatalogCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Modificó producto "${product.name}" (${id})`,
    request,
    metadata: { productId: id, changes: input },
  });

  return reply.send({ product });
}

export async function deleteProductHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = productIdParamsSchema.parse(request.params);

  await deleteProduct(id);
  await invalidateCatalogCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Eliminó producto (${id})`,
    request,
    metadata: { productId: id },
  });

  return reply.code(204).send();
}
