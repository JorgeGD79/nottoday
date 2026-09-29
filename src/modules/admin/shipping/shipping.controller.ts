import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { recordAuditLog } from "@/services/audit-log.service";
import { invalidateShippingCache } from "@/services/cache.service";
import {
  createShippingMethodSchema,
  createShippingZoneSchema,
  shippingMethodIdParamsSchema,
  updateShippingMethodSchema,
  updateShippingZoneSchema,
} from "./shipping.schema";

export async function listShippingMethodsAdminHandler(_request: FastifyRequest, reply: FastifyReply) {
  const [methods, zones] = await Promise.all([
    prisma.shippingMethod.findMany({
      include: { zone: { select: { id: true, name: true } } },
      orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
    }),
    prisma.shippingZone.findMany({
      include: { _count: { select: { methods: true } } },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  return reply.send({ methods, zones });
}

/**
 * POST /api/admin/shipping
 *
 * El admin define aquí los tipos de envío que ve el comprador en el checkout
 * (nombre + coste). Los pedidos guardan un snapshot, así que editar o borrar
 * un método nunca altera pedidos ya realizados.
 */
export async function createShippingMethodHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createShippingMethodSchema.parse(request.body);

  const method = await prisma.shippingMethod.create({ data: input });
  await invalidateShippingCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Creó el método de envío "${method.name}" (${Number(method.price)} €)`,
    request,
    metadata: { shippingMethodId: method.id },
  });

  return reply.code(201).send({ method });
}

export async function updateShippingMethodHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = shippingMethodIdParamsSchema.parse(request.params);
  const input = updateShippingMethodSchema.parse(request.body);

  const existing = await prisma.shippingMethod.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Método de envío");

  const method = await prisma.shippingMethod.update({ where: { id }, data: input });
  await invalidateShippingCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Actualizó el método de envío "${method.name}" (${id})`,
    request,
    metadata: { shippingMethodId: id, changes: input },
  });

  return reply.send({ method });
}

export async function deleteShippingMethodHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = shippingMethodIdParamsSchema.parse(request.params);

  const existing = await prisma.shippingMethod.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Método de envío");

  // onDelete: SetNull en Order.shippingMethodId — los pedidos conservan su snapshot.
  await prisma.shippingMethod.delete({ where: { id } });
  await invalidateShippingCache();

  await recordAuditLog({
    userId: request.user.id,
    action: `Eliminó el método de envío "${existing.name}" (${id})`,
    request,
    metadata: { shippingMethodId: id },
  });

  return reply.code(204).send();
}

// --------------------------------------------------------------------------
// Zonas de envío (países). Un país solo puede estar en una zona.
// --------------------------------------------------------------------------

async function assertCountriesFree(countries: string[] | undefined, exceptZoneId?: string) {
  if (!countries?.length) return;
  const clash = await prisma.shippingZone.findFirst({
    where: { countries: { hasSome: countries }, ...(exceptZoneId ? { id: { not: exceptZoneId } } : {}) },
  });
  if (clash) {
    const repeated = countries.filter((c) => clash.countries.includes(c));
    throw AppError.conflict(`${repeated.join(", ")} ya está en la zona "${clash.name}"`);
  }
}

async function assertSingleRestOfWorld(restOfWorld: boolean | undefined, exceptZoneId?: string) {
  if (!restOfWorld) return;
  const other = await prisma.shippingZone.findFirst({
    where: { restOfWorld: true, ...(exceptZoneId ? { id: { not: exceptZoneId } } : {}) },
  });
  if (other) throw AppError.conflict(`Ya hay una zona "resto del mundo": ${other.name}`);
}

export async function createShippingZoneHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createShippingZoneSchema.parse(request.body);
  await assertCountriesFree(input.countries);
  await assertSingleRestOfWorld(input.restOfWorld);

  const zone = await prisma.shippingZone.create({ data: input });
  await invalidateShippingCache();
  await recordAuditLog({
    userId: request.user.id,
    action: `Creó la zona de envío "${zone.name}" (${zone.restOfWorld ? "resto del mundo" : zone.countries.join(", ")})`,
    request,
    metadata: { shippingZoneId: zone.id },
  });
  return reply.code(201).send({ zone });
}

export async function updateShippingZoneHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = shippingMethodIdParamsSchema.parse(request.params);
  const input = updateShippingZoneSchema.parse(request.body);
  const existing = await prisma.shippingZone.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Zona de envío");
  await assertCountriesFree(input.countries, id);
  await assertSingleRestOfWorld(input.restOfWorld, id);

  const zone = await prisma.shippingZone.update({ where: { id }, data: input });
  await invalidateShippingCache();
  await recordAuditLog({
    userId: request.user.id,
    action: `Actualizó la zona de envío "${zone.name}" (${id})`,
    request,
    metadata: { shippingZoneId: id, changes: input },
  });
  return reply.send({ zone });
}

export async function deleteShippingZoneHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = shippingMethodIdParamsSchema.parse(request.params);
  const existing = await prisma.shippingZone.findUnique({ where: { id }, include: { _count: { select: { methods: true } } } });
  if (!existing) throw AppError.notFound("Zona de envío");
  if (existing._count.methods > 0) {
    // Si se borrara, sus métodos (zoneId -> null) pasarían a valer para CUALQUIER país.
    throw AppError.conflict("La zona tiene métodos de envío: bórralos o muévelos a otra zona antes");
  }
  await prisma.shippingZone.delete({ where: { id } });
  await invalidateShippingCache();
  await recordAuditLog({
    userId: request.user.id,
    action: `Eliminó la zona de envío "${existing.name}" (${id})`,
    request,
    metadata: { shippingZoneId: id },
  });
  return reply.code(204).send();
}
