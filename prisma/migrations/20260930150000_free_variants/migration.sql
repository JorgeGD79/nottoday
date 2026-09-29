-- DropIndex
DROP INDEX "ProductVariant_productId_size_key";

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "color" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
-- La talla pasa de enum a texto libre CONSERVANDO los valores existentes.
ALTER COLUMN   "size" TYPE TEXT USING "size"::text;

-- Orden de las tallas ya existentes (S, M, L, XL) para que se sigan mostrando igual.
UPDATE "ProductVariant" SET "sortOrder" = CASE "size"
  WHEN 'S' THEN 10 WHEN 'M' THEN 20 WHEN 'L' THEN 30 WHEN 'XL' THEN 40 ELSE 0 END;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "variantLabel" TEXT NOT NULL DEFAULT '';

-- Snapshot de la talla en las líneas de pedido existentes.
UPDATE "OrderItem" oi SET "variantLabel" = pv."size"
FROM "ProductVariant" pv WHERE pv."id" = oi."productVariantId";

-- DropEnum
DROP TYPE "Size";

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_size_color_key" ON "ProductVariant"("productId", "size", "color");
