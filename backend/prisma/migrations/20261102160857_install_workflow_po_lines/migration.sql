-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "products" TEXT,
ADD COLUMN     "qty" INTEGER;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "installPlannedOn" TIMESTAMP(3),
ADD COLUMN     "installStatus" TEXT,
ADD COLUMN     "installedOn" TIMESTAMP(3),
ADD COLUMN     "signOffBy" TEXT,
ADD COLUMN     "signOffOn" TIMESTAMP(3);
