-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 21,
ADD COLUMN     "weightGrams" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ShippingMethod" ADD COLUMN     "freeOverAmount" DECIMAL(10,2),
ADD COLUMN     "maxWeightGrams" INTEGER,
ADD COLUMN     "pricePerExtraKg" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "zoneId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingTaxRate" DECIMAL(5,2) NOT NULL DEFAULT 21,
ADD COLUMN     "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxExempt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 21;

-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "restOfWorld" BOOLEAN NOT NULL DEFAULT false,
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ShippingMethod" ADD CONSTRAINT "ShippingMethod_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ShippingZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
