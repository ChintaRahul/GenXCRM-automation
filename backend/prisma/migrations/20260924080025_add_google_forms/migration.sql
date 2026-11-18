-- CreateEnum
CREATE TYPE "FormSubmissionStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "GoogleForm" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formUrl" TEXT NOT NULL,
    "leadIdEntryId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSubmissionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "leadId" TEXT,
    "externalResponseId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "status" "FormSubmissionStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoogleForm_orgId_idx" ON "GoogleForm"("orgId");

-- CreateIndex
CREATE INDEX "FormSubmission_orgId_submittedAt_idx" ON "FormSubmission"("orgId", "submittedAt");

-- CreateIndex
CREATE INDEX "FormSubmission_leadId_idx" ON "FormSubmission"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "FormSubmission_formId_externalResponseId_key" ON "FormSubmission"("formId", "externalResponseId");

-- AddForeignKey
ALTER TABLE "GoogleForm" ADD CONSTRAINT "GoogleForm_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "GoogleForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
