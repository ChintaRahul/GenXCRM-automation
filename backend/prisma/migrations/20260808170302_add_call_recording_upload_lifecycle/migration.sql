-- CreateEnum
CREATE TYPE "CallRecordingStatus" AS ENUM ('PENDING', 'UPLOADED', 'FAILED');

-- AlterTable
ALTER TABLE "CallRecording" ADD COLUMN     "communicationId" TEXT,
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "status" "CallRecordingStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "uploadedAt" TIMESTAMP(3),
ADD COLUMN     "uploadedById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CallRecording_s3Key_key" ON "CallRecording"("s3Key");

-- CreateIndex
CREATE UNIQUE INDEX "CallRecording_communicationId_key" ON "CallRecording"("communicationId");

-- CreateIndex
CREATE INDEX "CallRecording_uploadedById_idx" ON "CallRecording"("uploadedById");

-- AddForeignKey
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "Communication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: pre-existing CallRecording rows (seeded demo data predating the
-- upload-lifecycle status field) represent already-complete recordings, not
-- pending uploads. Without this, they'd default to PENDING and disappear
-- from the lead timeline, which only surfaces UPLOADED recordings.
UPDATE "CallRecording" SET "status" = 'UPLOADED', "uploadedAt" = "recordedAt";
