-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadStage" ADD VALUE 'CALL_BACK';
ALTER TYPE "LeadStage" ADD VALUE 'CALL_NOT_RECEIVED';
ALTER TYPE "LeadStage" ADD VALUE 'SWITCHED_OFF';
ALTER TYPE "LeadStage" ADD VALUE 'WHATSAPP_SENT';
