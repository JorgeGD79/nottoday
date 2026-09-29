import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { SLUG_REGEX, uniqueSlug } from "@/utils/slug";
import { recordAuditLog } from "@/services/audit-log.service";
import { invalidateCatalogCache } from "@/services/cache.service";
import { refreshSearchText } from "@/modules/admin/products/products.service";

const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().regex(SLUG_REGEX, "Slug no válido (a-z, 0-9 y guiones)").max(80).optional(),
  description: z.string().max(2000).optional(),
  seoTitle: z.string().trim().max(70).optional(),
  seoDescription: z.string().trim().max(160).optional(),
  sortOrder: z.number().int().nonnegative().default(0),
});
const idParams = z.object({ id: z.string().cuid() });

const slugTaken = (exceptId?: string) => async (slug: string) =>
  !!(await prisma.category.findFirst({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) } }));

export async function listCategoriesHandler(_request: FastifyRequest, reply: FastifyReply) {
  const categories = await prisma.category.findMany({
    include: { _count: { select: { products: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return reply.send({ categories });
}

export async function createCategoryHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = categorySchema.parse(request.body);
  if (input.slug && (await slugTaken()(input.slug))) throw AppError.conflict(`El slug "${input.slug}" ya existe`);
  const slug = input.slug ?? (await uniqueSlug(input.name, slugTaken()));

  const category = await prisma.category.create({
    data: { ...input, slug, seoTitle: input.seoTitle || null, seoDescription: input.seoDescription || null },
  });
  await invalidateCatalogCache();
  await recordAuditLog({ userId: request.user.id, action: `Creó la categoría "${category.name}"`, request, metadata: { categoryId: category.id } });
  return reply.code(201).send({ category });
}

export async function updateCategoryHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = idParams.parse(request.params);
  const input = categorySchema.partial().parse(request.body);
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Categoría");
  if (input.slug && input.slug !== existing.slug && (await slugTaken(id)(input.slug))) {
    throw AppError.conflict(`El slug "${input.slug}" ya existe`);
  }

  const category = await prisma.category.update({
    where: { id },
    data: {
      ...input,
      seoTitle: input.seoTitle === undefined ? undefined : input.seoTitle || null,
      seoDescription: input.seoDescription === undefined ? undefined : input.seoDescription || null,
    },
  });
  if (input.name && input.name !== existing.name) {
    // El nombre de la categoría forma parte del texto de búsqueda de sus productos.
    const products = await prisma.product.findMany({ where: { categoryId: id }, select: { id: true } });
    for (const p of products) await refreshSearchText(prisma, p.id);
  }
  await invalidateCatalogCache();
  await recordAuditLog({ userId: request.user.id, action: `Actualizó la categoría "${category.name}"`, request, metadata: { categoryId: id, changes: input } });
  return reply.send({ category });
}

/** Borrar una categoría no borra sus productos: quedan sin categoría. */
export async function deleteCategoryHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = idParams.parse(request.params);
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Categoría");
  await prisma.category.delete({ where: { id } });
  await invalidateCatalogCache();
  await recordAuditLog({ userId: request.user.id, action: `Eliminó la categoría "${existing.name}"`, request, metadata: { categoryId: id } });
  return reply.code(204).send();
}
