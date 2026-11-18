-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "securitySettings" JSONB,
ADD COLUMN "notificationSettings" JSONB,
ADD COLUMN "routingSettings" JSONB,
ADD COLUMN "coreFieldAliases" JSONB,
ADD COLUMN "customFieldDefs" JSONB,
ADD COLUMN "apiKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_apiKey_key" ON "Organization"("apiKey");
