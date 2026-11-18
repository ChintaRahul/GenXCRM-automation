-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "rawFields" JSONB;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "fieldOrder" JSONB;
