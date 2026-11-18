-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "custContactId" TEXT,
ADD COLUMN     "special" TEXT;

-- CreateIndex
CREATE INDEX "SalesOrder_custContactId_idx" ON "SalesOrder"("custContactId");

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_custContactId_fkey" FOREIGN KEY ("custContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
