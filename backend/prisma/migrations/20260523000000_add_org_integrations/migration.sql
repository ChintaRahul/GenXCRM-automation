-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('FACEBOOK', 'GOOGLE_ADS', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "orgWebhookToken" TEXT;

-- CreateTable
CREATE TABLE "OrgIntegration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "accountId" TEXT,
    "accountName" TEXT,
    "webhookSecret" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_orgWebhookToken_key" ON "Organization"("orgWebhookToken");

-- CreateIndex
CREATE UNIQUE INDEX "OrgIntegration_orgId_provider_key" ON "OrgIntegration"("orgId", "provider");

-- CreateIndex
CREATE INDEX "OrgIntegration_orgId_idx" ON "OrgIntegration"("orgId");

-- CreateIndex
CREATE INDEX "OrgIntegration_accountId_idx" ON "OrgIntegration"("accountId");

-- AddForeignKey
ALTER TABLE "OrgIntegration" ADD CONSTRAINT "OrgIntegration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
