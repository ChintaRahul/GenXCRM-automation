-- Remove the WEBINAR_ATTENDED lead stage. Any existing leads on that stage are
-- reassigned to DEMO_ATTENDED (the two were tracking the same "attended a
-- session" moment in the pipeline) before the enum type is narrowed, since
-- Postgres has no direct DROP VALUE and the column-type swap below requires
-- every existing row to already fit the new enum.
BEGIN;

UPDATE "Lead" SET "stage" = 'DEMO_ATTENDED' WHERE "stage" = 'WEBINAR_ATTENDED';

-- AlterEnum
CREATE TYPE "LeadStage_new" AS ENUM ('NEW', 'CONTACTED', 'INTERESTED', 'RINGING_NOT_REACHABLE', 'FOLLOW_UP_REQUIRED', 'CALL_BACK', 'CALL_NOT_RECEIVED', 'SWITCHED_OFF', 'WHATSAPP_SENT', 'DEMO_SCHEDULED', 'DEMO_ATTENDED', 'NEGOTIATION', 'ENROLLMENT_PENDING', 'ENROLLED', 'NOT_INTERESTED', 'DROPPED', 'CLOSED_WON', 'CLOSED_LOST');
ALTER TABLE "Lead" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "Lead" ALTER COLUMN "stage" TYPE "LeadStage_new" USING ("stage"::text::"LeadStage_new");
ALTER TYPE "LeadStage" RENAME TO "LeadStage_old";
ALTER TYPE "LeadStage_new" RENAME TO "LeadStage";
DROP TYPE "LeadStage_old";
ALTER TABLE "Lead" ALTER COLUMN "stage" SET DEFAULT 'NEW';

COMMIT;
