-- CreateTable
CREATE TABLE "Dealer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "territory" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "commission" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "ownerId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dealer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealerDeal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealerId" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "registeredOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresOn" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealerDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tender" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tenderNo" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "accountId" TEXT,
    "opportunityId" TEXT,
    "estimatedValue" DOUBLE PRECISION NOT NULL,
    "publishedOn" TIMESTAMP(3),
    "submissionDeadline" TIMESTAMP(3) NOT NULL,
    "openingDate" TIMESTAMP(3),
    "emdAmount" DOUBLE PRECISION,
    "emdStatus" TEXT NOT NULL DEFAULT 'Not required',
    "docsReady" BOOLEAN NOT NULL DEFAULT false,
    "technicalBidReady" BOOLEAN NOT NULL DEFAULT false,
    "financialBidReady" BOOLEAN NOT NULL DEFAULT false,
    "preBidAttended" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "outcomeNote" TEXT,
    "ownerId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "entities" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSyncLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "records" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfgNurtureEnrollment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MfgNurtureEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dealer_orgId_idx" ON "Dealer"("orgId");

-- CreateIndex
CREATE INDEX "Dealer_ownerId_idx" ON "Dealer"("ownerId");

-- CreateIndex
CREATE INDEX "DealerDeal_orgId_idx" ON "DealerDeal"("orgId");

-- CreateIndex
CREATE INDEX "DealerDeal_dealerId_idx" ON "DealerDeal"("dealerId");

-- CreateIndex
CREATE INDEX "Tender_orgId_idx" ON "Tender"("orgId");

-- CreateIndex
CREATE INDEX "Tender_ownerId_idx" ON "Tender"("ownerId");

-- CreateIndex
CREATE INDEX "Tender_submissionDeadline_idx" ON "Tender"("submissionDeadline");

-- CreateIndex
CREATE INDEX "ErpConnection_orgId_idx" ON "ErpConnection"("orgId");

-- CreateIndex
CREATE INDEX "ErpSyncLog_connectionId_idx" ON "ErpSyncLog"("connectionId");

-- CreateIndex
CREATE INDEX "ErpSyncLog_orgId_idx" ON "ErpSyncLog"("orgId");

-- CreateIndex
CREATE INDEX "MfgNurtureEnrollment_status_nextRunAt_idx" ON "MfgNurtureEnrollment"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "MfgNurtureEnrollment_orgId_idx" ON "MfgNurtureEnrollment"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "MfgNurtureEnrollment_sequenceId_entityType_entityId_key" ON "MfgNurtureEnrollment"("sequenceId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Dealer" ADD CONSTRAINT "Dealer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dealer" ADD CONSTRAINT "Dealer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealerDeal" ADD CONSTRAINT "DealerDeal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealerDeal" ADD CONSTRAINT "DealerDeal_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tender" ADD CONSTRAINT "Tender_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tender" ADD CONSTRAINT "Tender_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tender" ADD CONSTRAINT "Tender_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tender" ADD CONSTRAINT "Tender_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpConnection" ADD CONSTRAINT "ErpConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSyncLog" ADD CONSTRAINT "ErpSyncLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSyncLog" ADD CONSTRAINT "ErpSyncLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ErpConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfgNurtureEnrollment" ADD CONSTRAINT "MfgNurtureEnrollment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfgNurtureEnrollment" ADD CONSTRAINT "MfgNurtureEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "NurturingSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing orgs get dealers/tenders permissions modelled on their Opportunities rules.
INSERT INTO "RolePermission" ("id", "orgId", "role", "moduleKey", "recordAccess", "canCreate", "canRead", "canUpdate", "canDelete", "canExport", "isDeleted", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, rp."orgId", rp."role", m."key", rp."recordAccess", rp."canCreate", rp."canRead", rp."canUpdate", rp."canDelete", rp."canExport", false, now(), now()
FROM "RolePermission" rp
CROSS JOIN (VALUES ('dealers'), ('tenders')) AS m("key")
WHERE rp."moduleKey" = 'opps' AND rp."isDeleted" = false;
