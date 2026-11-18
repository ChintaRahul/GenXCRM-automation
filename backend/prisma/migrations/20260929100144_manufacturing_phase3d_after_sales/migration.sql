-- CreateTable
CREATE TABLE "InstalledAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "plant" TEXT,
    "location" TEXT,
    "salesOrderId" TEXT,
    "status" TEXT NOT NULL,
    "installedOn" TIMESTAMP(3),
    "commissionedOn" TIMESTAMP(3),
    "warrantyStart" TIMESTAMP(3),
    "warrantyEnd" TIMESTAMP(3),
    "customerSignoff" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstalledAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coverage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION,
    "visitsIncluded" INTEGER,
    "visitsUsed" INTEGER,
    "terms" TEXT,
    "ownerId" TEXT,
    "renewalOpportunityId" TEXT,
    "status" TEXT NOT NULL,
    "lostReason" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTicket" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "plant" TEXT,
    "assetId" TEXT,
    "complaintType" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "coverage" TEXT,
    "status" TEXT NOT NULL,
    "engineerId" TEXT,
    "responseDue" TEXT,
    "visitDate" TIMESTAMP(3),
    "diagnosis" TEXT,
    "partsRequired" TEXT,
    "action" TEXT,
    "resolution" TEXT,
    "customerConfirmation" TEXT,
    "chargeable" BOOLEAN,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstalledAsset_orgId_idx" ON "InstalledAsset"("orgId");

-- CreateIndex
CREATE INDEX "InstalledAsset_accountId_idx" ON "InstalledAsset"("accountId");

-- CreateIndex
CREATE INDEX "InstalledAsset_salesOrderId_idx" ON "InstalledAsset"("salesOrderId");

-- CreateIndex
CREATE INDEX "InstalledAsset_status_idx" ON "InstalledAsset"("status");

-- CreateIndex
CREATE INDEX "Coverage_orgId_idx" ON "Coverage"("orgId");

-- CreateIndex
CREATE INDEX "Coverage_assetId_idx" ON "Coverage"("assetId");

-- CreateIndex
CREATE INDEX "Coverage_accountId_idx" ON "Coverage"("accountId");

-- CreateIndex
CREATE INDEX "Coverage_ownerId_idx" ON "Coverage"("ownerId");

-- CreateIndex
CREATE INDEX "Coverage_status_idx" ON "Coverage"("status");

-- CreateIndex
CREATE INDEX "ServiceTicket_orgId_idx" ON "ServiceTicket"("orgId");

-- CreateIndex
CREATE INDEX "ServiceTicket_accountId_idx" ON "ServiceTicket"("accountId");

-- CreateIndex
CREATE INDEX "ServiceTicket_assetId_idx" ON "ServiceTicket"("assetId");

-- CreateIndex
CREATE INDEX "ServiceTicket_engineerId_idx" ON "ServiceTicket"("engineerId");

-- CreateIndex
CREATE INDEX "ServiceTicket_status_idx" ON "ServiceTicket"("status");

-- AddForeignKey
ALTER TABLE "InstalledAsset" ADD CONSTRAINT "InstalledAsset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstalledAsset" ADD CONSTRAINT "InstalledAsset_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstalledAsset" ADD CONSTRAINT "InstalledAsset_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coverage" ADD CONSTRAINT "Coverage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coverage" ADD CONSTRAINT "Coverage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "InstalledAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coverage" ADD CONSTRAINT "Coverage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coverage" ADD CONSTRAINT "Coverage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coverage" ADD CONSTRAINT "Coverage_renewalOpportunityId_fkey" FOREIGN KEY ("renewalOpportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "InstalledAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
