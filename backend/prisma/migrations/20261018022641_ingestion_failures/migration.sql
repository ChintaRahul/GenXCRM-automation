-- CreateTable
CREATE TABLE "IngestionFailure" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "platform" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "leadgenId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestionFailure_orgId_reportedAt_idx" ON "IngestionFailure"("orgId", "reportedAt");

-- AddForeignKey
ALTER TABLE "IngestionFailure" ADD CONSTRAINT "IngestionFailure_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
