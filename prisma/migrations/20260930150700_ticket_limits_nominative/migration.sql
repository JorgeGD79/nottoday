-- AlterTable
ALTER TABLE "Event" ADD COLUMN "maxTicketsPerEmail" INTEGER,
ADD COLUMN "nominativeTickets" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "attendeeNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "holderName" TEXT;
