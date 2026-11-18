-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "custNo" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "receivedOn" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "status" TEXT NOT NULL,
    "application" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "qty" INTEGER,
    "capacity" TEXT,
    "dimensions" TEXT,
    "accuracy" TEXT,
    "material" TEXT,
    "environment" TEXT,
    "utilities" TEXT,
    "protocol" TEXT,
    "erp" TEXT,
    "installRequired" BOOLEAN,
    "calibRequired" BOOLEAN,
    "compliance" TEXT,
    "delivery" TEXT,
    "specialConditions" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqRevision" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RfqRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteVisit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "opportunityId" TEXT,
    "accountId" TEXT NOT NULL,
    "plant" TEXT,
    "visitDate" TIMESTAMP(3) NOT NULL,
    "time" TEXT,
    "ownerId" TEXT,
    "engineers" TEXT,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "existingSystem" TEXT,
    "customerProblem" TEXT,
    "measurements" TEXT,
    "observations" TEXT,
    "recommendation" TEXT,
    "customerComments" TEXT,
    "nextAction" TEXT,
    "nextActionDate" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "product" TEXT,
    "serial" TEXT,
    "sampleQty" INTEGER,
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "actualDate" TIMESTAMP(3),
    "ownerId" TEXT,
    "status" TEXT NOT NULL,
    "parameters" TEXT,
    "application" TEXT,
    "result" TEXT,
    "feedback" TEXT,
    "approvedByCustomer" TEXT,
    "sampleDispatched" TIMESTAMP(3),
    "sampleDelivered" TIMESTAMP(3),
    "sampleTested" TIMESTAMP(3),
    "nextAction" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "variant" TEXT,
    "description" TEXT,
    "uom" TEXT,
    "hsn" TEXT,
    "gstRate" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "minPrice" DOUBLE PRECISION,
    "cost" DOUBLE PRECISION,
    "leadTime" TEXT,
    "warrantyMonths" INTEGER,
    "status" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingSheet" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "accountId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "approvedById" TEXT,
    "status" TEXT NOT NULL,
    "material" DOUBLE PRECISION,
    "boughtOut" DOUBLE PRECISION,
    "fabrication" DOUBLE PRECISION,
    "electrical" DOUBLE PRECISION,
    "software" DOUBLE PRECISION,
    "labor" DOUBLE PRECISION,
    "installation" DOUBLE PRECISION,
    "freight" DOUBLE PRECISION,
    "packing" DOUBLE PRECISION,
    "travel" DOUBLE PRECISION,
    "overhead" DOUBLE PRECISION,
    "contingency" DOUBLE PRECISION,
    "other" DOUBLE PRECISION,
    "sellingPrice" DOUBLE PRECISION NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostingSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "quotationDate" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "ownerId" TEXT,
    "status" TEXT NOT NULL,
    "paymentTerms" TEXT NOT NULL,
    "deliveryTerms" TEXT,
    "deliveryTime" TEXT,
    "warranty" TEXT,
    "freight" DOUBLE PRECISION,
    "installation" DOUBLE PRECISION,
    "exclusions" TEXT,
    "termsAndConditions" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT,
    "qty" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentApprover" TEXT,
    "level" INTEGER,
    "matchedRule" TEXT,
    "reason" TEXT,
    "approverComments" TEXT,
    "status" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rfq_orgId_idx" ON "Rfq"("orgId");

-- CreateIndex
CREATE INDEX "Rfq_opportunityId_idx" ON "Rfq"("opportunityId");

-- CreateIndex
CREATE INDEX "Rfq_accountId_idx" ON "Rfq"("accountId");

-- CreateIndex
CREATE INDEX "Rfq_ownerId_idx" ON "Rfq"("ownerId");

-- CreateIndex
CREATE INDEX "Rfq_status_idx" ON "Rfq"("status");

-- CreateIndex
CREATE INDEX "RfqRevision_rfqId_idx" ON "RfqRevision"("rfqId");

-- CreateIndex
CREATE INDEX "SiteVisit_orgId_idx" ON "SiteVisit"("orgId");

-- CreateIndex
CREATE INDEX "SiteVisit_opportunityId_idx" ON "SiteVisit"("opportunityId");

-- CreateIndex
CREATE INDEX "SiteVisit_accountId_idx" ON "SiteVisit"("accountId");

-- CreateIndex
CREATE INDEX "SiteVisit_ownerId_idx" ON "SiteVisit"("ownerId");

-- CreateIndex
CREATE INDEX "SiteVisit_status_idx" ON "SiteVisit"("status");

-- CreateIndex
CREATE INDEX "Evaluation_orgId_idx" ON "Evaluation"("orgId");

-- CreateIndex
CREATE INDEX "Evaluation_opportunityId_idx" ON "Evaluation"("opportunityId");

-- CreateIndex
CREATE INDEX "Evaluation_accountId_idx" ON "Evaluation"("accountId");

-- CreateIndex
CREATE INDEX "Evaluation_ownerId_idx" ON "Evaluation"("ownerId");

-- CreateIndex
CREATE INDEX "Evaluation_status_idx" ON "Evaluation"("status");

-- CreateIndex
CREATE INDEX "Product_orgId_idx" ON "Product"("orgId");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "Product_sku_idx" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "CostingSheet_orgId_idx" ON "CostingSheet"("orgId");

-- CreateIndex
CREATE INDEX "CostingSheet_opportunityId_idx" ON "CostingSheet"("opportunityId");

-- CreateIndex
CREATE INDEX "CostingSheet_ownerId_idx" ON "CostingSheet"("ownerId");

-- CreateIndex
CREATE INDEX "CostingSheet_status_idx" ON "CostingSheet"("status");

-- CreateIndex
CREATE INDEX "Quotation_orgId_idx" ON "Quotation"("orgId");

-- CreateIndex
CREATE INDEX "Quotation_opportunityId_idx" ON "Quotation"("opportunityId");

-- CreateIndex
CREATE INDEX "Quotation_accountId_idx" ON "Quotation"("accountId");

-- CreateIndex
CREATE INDEX "Quotation_ownerId_idx" ON "Quotation"("ownerId");

-- CreateIndex
CREATE INDEX "Quotation_status_idx" ON "Quotation"("status");

-- CreateIndex
CREATE INDEX "Quotation_parentId_idx" ON "Quotation"("parentId");

-- CreateIndex
CREATE INDEX "QuotationLine_quotationId_idx" ON "QuotationLine"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationLine_productId_idx" ON "QuotationLine"("productId");

-- CreateIndex
CREATE INDEX "Approval_orgId_idx" ON "Approval"("orgId");

-- CreateIndex
CREATE INDEX "Approval_entityType_entityId_idx" ON "Approval"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Approval_requestedById_idx" ON "Approval"("requestedById");

-- CreateIndex
CREATE INDEX "Approval_status_idx" ON "Approval"("status");

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqRevision" ADD CONSTRAINT "RfqRevision_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqRevision" ADD CONSTRAINT "RfqRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingSheet" ADD CONSTRAINT "CostingSheet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingSheet" ADD CONSTRAINT "CostingSheet_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingSheet" ADD CONSTRAINT "CostingSheet_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingSheet" ADD CONSTRAINT "CostingSheet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingSheet" ADD CONSTRAINT "CostingSheet_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
