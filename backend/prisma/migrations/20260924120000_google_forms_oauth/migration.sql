-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'GOOGLE_FORMS';

-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN     "sheetError" TEXT,
ADD COLUMN     "sheetSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "GoogleForm" ADD COLUMN     "googleFormId" TEXT,
ADD COLUMN     "lastResponseAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "leadIdQuestionId" TEXT,
ADD COLUMN     "questionTitles" JSONB,
ADD COLUMN     "responderUri" TEXT,
ADD COLUMN     "sheetId" TEXT,
ADD COLUMN     "sheetTab" TEXT,
ADD COLUMN     "syncError" TEXT,
ALTER COLUMN "secret" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "FormSubmission_formId_status_idx" ON "FormSubmission"("formId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleForm_orgId_googleFormId_key" ON "GoogleForm"("orgId", "googleFormId");


-- Legacy Apps Script forms stop syncing and show as "Legacy — reconnect" in the UI.
UPDATE "GoogleForm" SET "isActive" = false;
