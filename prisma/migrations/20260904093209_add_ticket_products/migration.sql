-- AlterEnum
ALTER TYPE "ProductType" ADD VALUE 'TICKET_EVENTO';

-- AlterEnum
ALTER TYPE "Size" ADD VALUE 'GENERAL';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "eventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_eventId_key" ON "Product"("eventId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

