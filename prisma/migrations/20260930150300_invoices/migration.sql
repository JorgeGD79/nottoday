-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "billingName" TEXT,
ADD COLUMN     "billingTaxId" TEXT,
ADD COLUMN     "creditNoteDate" TIMESTAMP(3),
ADD COLUMN     "creditNoteNumber" TEXT,
ADD COLUMN     "invoiceDate" TIMESTAMP(3),
ADD COLUMN     "invoiceNumber" TEXT;

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "id" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_invoiceNumber_key" ON "Order"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_creditNoteNumber_key" ON "Order"("creditNoteNumber");
