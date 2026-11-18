-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "customStageId" TEXT;

-- CreateTable
CREATE TABLE "StageConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "baseStage" "LeadStage",
    "countsAs" "LeadStage",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StageConfig_orgId_idx" ON "StageConfig"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "StageConfig_orgId_baseStage_key" ON "StageConfig"("orgId", "baseStage");

-- CreateIndex
CREATE INDEX "Lead_customStageId_idx" ON "Lead"("customStageId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customStageId_fkey" FOREIGN KEY ("customStageId") REFERENCES "StageConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageConfig" ADD CONSTRAINT "StageConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
