-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "attendeeDocuments" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "holderDocument" TEXT;

