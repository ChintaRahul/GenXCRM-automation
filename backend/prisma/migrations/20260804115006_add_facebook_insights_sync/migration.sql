-- AlterTable
ALTER TABLE "Ad" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "AdSet" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "OrgIntegration" ADD COLUMN     "adAccountAccessToken" TEXT,
ADD COLUMN     "adAccountId" TEXT,
ADD COLUMN     "adAccountName" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Ad_adSetId_externalId_key" ON "Ad"("adSetId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AdSet_campaignId_externalId_key" ON "AdSet"("campaignId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_orgId_externalId_key" ON "Campaign"("orgId", "externalId");

-- CreateIndex
CREATE INDEX "OrgIntegration_adAccountId_idx" ON "OrgIntegration"("adAccountId");
