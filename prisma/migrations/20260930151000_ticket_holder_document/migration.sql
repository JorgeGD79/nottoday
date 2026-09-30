-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "attendeeDocuments" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "holderDocument" TEXT;

-- CreateIndex
CREATE INDEX "Ticket_eventId_holderDocument_idx" ON "Ticket"("eventId", "holderDocument");
