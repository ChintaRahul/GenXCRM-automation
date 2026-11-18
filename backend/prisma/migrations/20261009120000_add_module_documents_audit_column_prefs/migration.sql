-- CreateTable
CREATE TABLE "ModuleColumnPref" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleColumnPref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleAuditEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuleAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModuleColumnPref_orgId_userId_moduleKey_key" ON "ModuleColumnPref"("orgId", "userId", "moduleKey");

-- CreateIndex
CREATE INDEX "ModuleAuditEntry_orgId_moduleKey_recordId_idx" ON "ModuleAuditEntry"("orgId", "moduleKey", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleDocument_s3Key_key" ON "ModuleDocument"("s3Key");

-- CreateIndex
CREATE INDEX "ModuleDocument_orgId_moduleKey_recordId_idx" ON "ModuleDocument"("orgId", "moduleKey", "recordId");

-- AddForeignKey
ALTER TABLE "ModuleColumnPref" ADD CONSTRAINT "ModuleColumnPref_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleColumnPref" ADD CONSTRAINT "ModuleColumnPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleAuditEntry" ADD CONSTRAINT "ModuleAuditEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleAuditEntry" ADD CONSTRAINT "ModuleAuditEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleDocument" ADD CONSTRAINT "ModuleDocument_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleDocument" ADD CONSTRAINT "ModuleDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

