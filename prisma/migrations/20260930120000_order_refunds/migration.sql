-- Reembolsos de pedidos
ALTER TYPE "OrderStatus" ADD VALUE 'REEMBOLSADO';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "stripeRefundId" TEXT;
