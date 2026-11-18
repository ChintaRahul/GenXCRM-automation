-- Allow an org-wide round-robin cursor (no team) alongside the existing per-team cursor.
-- AlterTable
ALTER TABLE "AssignmentState" ALTER COLUMN "teamId" DROP NOT NULL;
ALTER TABLE "AssignmentState" ADD COLUMN "orgId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentState_orgId_key" ON "AssignmentState"("orgId");
