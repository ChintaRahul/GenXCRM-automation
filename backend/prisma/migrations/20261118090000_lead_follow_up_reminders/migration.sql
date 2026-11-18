-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "followUpAt" TIMESTAMP(3),
ADD COLUMN     "followUpNote" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "followUpDigestSentOn" TEXT;

-- CreateIndex
CREATE INDEX "Lead_followUpAt_idx" ON "Lead"("followUpAt");
