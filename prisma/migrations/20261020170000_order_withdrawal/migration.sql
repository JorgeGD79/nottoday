-- Desistimiento online: cuándo y quién lo pidió desde el seguimiento del pedido.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "withdrawalNote" TEXT,
ADD COLUMN     "withdrawalName" TEXT,
ADD COLUMN     "withdrawalRequestedAt" TIMESTAMP(3);
