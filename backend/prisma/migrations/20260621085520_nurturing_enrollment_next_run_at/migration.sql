-- AlterTable
ALTER TABLE "NurturingEnrollment" ADD COLUMN     "nextRunAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "NurturingEnrollment_status_nextRunAt_idx" ON "NurturingEnrollment"("status", "nextRunAt");
