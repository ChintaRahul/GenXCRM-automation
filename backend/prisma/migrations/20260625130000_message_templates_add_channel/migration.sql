-- CreateEnum
CREATE TYPE "TemplateChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- Rename EmailTemplate -> message_templates (data preserved) and align constraint/index names
-- with Prisma's conventions for the renamed model.
ALTER TABLE "EmailTemplate" RENAME TO "message_templates";
ALTER TABLE "message_templates" RENAME CONSTRAINT "EmailTemplate_pkey" TO "message_templates_pkey";
ALTER INDEX "EmailTemplate_orgId_idx" RENAME TO "message_templates_orgId_idx";
ALTER TABLE "message_templates" RENAME CONSTRAINT "EmailTemplate_orgId_fkey" TO "message_templates_orgId_fkey";
ALTER TABLE "message_templates" RENAME CONSTRAINT "EmailTemplate_createdById_fkey" TO "message_templates_createdById_fkey";

-- Add channel (existing rows are email) and make subject optional (WhatsApp has no subject).
ALTER TABLE "message_templates" ADD COLUMN "channel" "TemplateChannel" NOT NULL DEFAULT 'EMAIL';
ALTER TABLE "message_templates" ALTER COLUMN "subject" DROP NOT NULL;
