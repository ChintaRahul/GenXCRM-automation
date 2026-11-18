-- AlterTable
ALTER TABLE "MfgLead" ADD COLUMN "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MfgLead_orgId_externalId_key" ON "MfgLead"("orgId", "externalId");
