-- AlterTable
ALTER TABLE "NurturingStep" ADD COLUMN     "templateLang" TEXT,
ADD COLUMN     "templateName" TEXT,
ADD COLUMN     "templateParams" JSONB;
