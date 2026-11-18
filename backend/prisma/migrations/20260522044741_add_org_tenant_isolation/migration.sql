-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "NurturingSequence" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "orgId" TEXT;

-- CreateIndex
CREATE INDEX "Lead_orgId_idx" ON "Lead"("orgId");

-- CreateIndex
CREATE INDEX "NurturingSequence_orgId_idx" ON "NurturingSequence"("orgId");

-- CreateIndex
CREATE INDEX "Team_orgId_idx" ON "Team"("orgId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NurturingSequence" ADD CONSTRAINT "NurturingSequence_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
