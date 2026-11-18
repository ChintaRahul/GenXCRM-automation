-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "activityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Lead_activityAt_idx" ON "Lead"("activityAt");
