-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "leadgenId" TEXT;

-- CreateIndex
CREATE INDEX "Lead_leadgenId_idx" ON "Lead"("leadgenId");
