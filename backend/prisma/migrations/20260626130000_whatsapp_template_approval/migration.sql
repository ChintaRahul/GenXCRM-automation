-- CreateEnum
CREATE TYPE "WhatsappTemplateStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: WhatsApp-only Meta approval tracking columns (all nullable; EMAIL rows leave them null)
ALTER TABLE "message_templates"
  ADD COLUMN "status" "WhatsappTemplateStatus",
  ADD COLUMN "language" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "metaTemplateName" TEXT,
  ADD COLUMN "metaTemplateId" TEXT,
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "variables" JSONB;
