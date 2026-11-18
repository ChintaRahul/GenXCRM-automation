-- AlterTable
ALTER TABLE "SlaTimer" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "lastEscalationLevel" INTEGER NOT NULL DEFAULT 0;
