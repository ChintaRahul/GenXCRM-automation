-- CreateEnum
CREATE TYPE "MfgRole" AS ENUM ('SUPER_ADMIN', 'DIRECTOR', 'SALES_HEAD', 'SALES_MANAGER', 'SALES_EXECUTIVE', 'APPLICATION_ENGINEER', 'COMMERCIAL_ESTIMATION', 'OPERATIONS', 'ACCOUNTS', 'SERVICE_MANAGER', 'SERVICE_ENGINEER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfgRole" "MfgRole";

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "subIndustry" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "website" TEXT,
    "billing" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT,
    "territory" TEXT NOT NULL,
    "potential" DOUBLE PRECISION,
    "creditTerms" TEXT,
    "source" TEXT,
    "tags" TEXT[],
    "ownerId" TEXT,
    "status" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plant" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "city" TEXT NOT NULL,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "plant" TEXT,
    "designation" TEXT,
    "department" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "email" TEXT,
    "channel" TEXT,
    "role" TEXT NOT NULL,
    "influence" TEXT,
    "status" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfgLead" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "designation" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT,
    "state" TEXT,
    "industry" TEXT,
    "product" TEXT NOT NULL,
    "requirement" TEXT,
    "source" TEXT NOT NULL,
    "campaign" TEXT,
    "value" DOUBLE PRECISION,
    "timeline" TEXT,
    "qReq" TEXT,
    "qApp" TEXT,
    "qQty" TEXT,
    "qBudget" TEXT,
    "qAuth" TEXT,
    "qNeed" TEXT,
    "qTime" TEXT,
    "ownerId" TEXT,
    "status" TEXT NOT NULL,
    "next" TEXT,
    "nextDate" TIMESTAMP(3),
    "disqualifyReason" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MfgLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "plant" TEXT,
    "contactId" TEXT,
    "product" TEXT NOT NULL,
    "qty" INTEGER,
    "summary" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "stage" TEXT NOT NULL,
    "closeDate" TIMESTAMP(3) NOT NULL,
    "competitor" TEXT,
    "source" TEXT,
    "ownerId" TEXT,
    "technicalOwnerId" TEXT,
    "nextAction" TEXT NOT NULL,
    "nextActionDate" TIMESTAMP(3) NOT NULL,
    "lostReason" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityStageHistory" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfgActivity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "accountId" TEXT,
    "opportunityId" TEXT,
    "contactId" TEXT,
    "mfgLeadId" TEXT,
    "dueDate" TIMESTAMP(3),
    "dueTime" TEXT,
    "priority" TEXT NOT NULL,
    "ownerId" TEXT,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "outcome" TEXT,
    "nextAction" TEXT,
    "nextActionDate" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MfgActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_orgId_idx" ON "Account"("orgId");

-- CreateIndex
CREATE INDEX "Account_ownerId_idx" ON "Account"("ownerId");

-- CreateIndex
CREATE INDEX "Account_status_idx" ON "Account"("status");

-- CreateIndex
CREATE INDEX "Account_gstin_idx" ON "Account"("gstin");

-- CreateIndex
CREATE INDEX "Plant_accountId_idx" ON "Plant"("accountId");

-- CreateIndex
CREATE INDEX "Contact_orgId_idx" ON "Contact"("orgId");

-- CreateIndex
CREATE INDEX "Contact_accountId_idx" ON "Contact"("accountId");

-- CreateIndex
CREATE INDEX "Contact_phone_idx" ON "Contact"("phone");

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "Contact"("email");

-- CreateIndex
CREATE INDEX "MfgLead_orgId_idx" ON "MfgLead"("orgId");

-- CreateIndex
CREATE INDEX "MfgLead_phone_idx" ON "MfgLead"("phone");

-- CreateIndex
CREATE INDEX "MfgLead_email_idx" ON "MfgLead"("email");

-- CreateIndex
CREATE INDEX "MfgLead_status_idx" ON "MfgLead"("status");

-- CreateIndex
CREATE INDEX "MfgLead_ownerId_idx" ON "MfgLead"("ownerId");

-- CreateIndex
CREATE INDEX "Opportunity_orgId_idx" ON "Opportunity"("orgId");

-- CreateIndex
CREATE INDEX "Opportunity_accountId_idx" ON "Opportunity"("accountId");

-- CreateIndex
CREATE INDEX "Opportunity_stage_idx" ON "Opportunity"("stage");

-- CreateIndex
CREATE INDEX "Opportunity_ownerId_idx" ON "Opportunity"("ownerId");

-- CreateIndex
CREATE INDEX "OpportunityStageHistory_opportunityId_idx" ON "OpportunityStageHistory"("opportunityId");

-- CreateIndex
CREATE INDEX "MfgActivity_orgId_idx" ON "MfgActivity"("orgId");

-- CreateIndex
CREATE INDEX "MfgActivity_ownerId_idx" ON "MfgActivity"("ownerId");

-- CreateIndex
CREATE INDEX "MfgActivity_status_idx" ON "MfgActivity"("status");

-- CreateIndex
CREATE INDEX "MfgActivity_accountId_idx" ON "MfgActivity"("accountId");

-- CreateIndex
CREATE INDEX "MfgActivity_opportunityId_idx" ON "MfgActivity"("opportunityId");

-- CreateIndex
CREATE INDEX "MfgActivity_contactId_idx" ON "MfgActivity"("contactId");

-- CreateIndex
CREATE INDEX "MfgActivity_mfgLeadId_idx" ON "MfgActivity"("mfgLeadId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfgLead" ADD CONSTRAINT "MfgLead_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfgLead" ADD CONSTRAINT "MfgLead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_technicalOwnerId_fkey" FOREIGN KEY ("technicalOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfgActivity" ADD CONSTRAINT "MfgActivity_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfgActivity" ADD CONSTRAINT "MfgActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfgActivity" ADD CONSTRAINT "MfgActivity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfgActivity" ADD CONSTRAINT "MfgActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfgActivity" ADD CONSTRAINT "MfgActivity_mfgLeadId_fkey" FOREIGN KEY ("mfgLeadId") REFERENCES "MfgLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfgActivity" ADD CONSTRAINT "MfgActivity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
