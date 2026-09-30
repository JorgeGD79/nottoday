-- AlterTable
ALTER TABLE "Event" ADD COLUMN "capacity" INTEGER;

-- Eventos que ya tenían ticket creado a mano: aforo = lo que queda a la venta
-- + las entradas ya emitidas (válidas o usadas; las anuladas volvieron al stock).
UPDATE "Event" e SET "capacity" = v."stockAvailable" + (
  SELECT count(*) FROM "Ticket" t WHERE t."eventId" = e."id" AND t."status" IN ('VALIDA', 'USADA')
)
FROM "Product" p
JOIN "ProductVariant" v ON v."productId" = p."id" AND v."size" = 'GENERAL'
WHERE p."eventId" = e."id" AND p."productType" = 'TICKET_EVENTO';
