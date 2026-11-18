-- Nurturing sequences are now opt-in: new sequences (and the provisioned default
-- "Welcome New Leads" sequence) start inactive and only run once a user activates them.
-- AlterTable
ALTER TABLE "NurturingSequence" ALTER COLUMN "isActive" SET DEFAULT false;
