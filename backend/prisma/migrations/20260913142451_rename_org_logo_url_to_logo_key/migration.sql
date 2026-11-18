-- Organization.logoUrl was never used (no UI ever wrote it) — repurposing it to store
-- an S3 object key instead of a raw URL, matching the rest of the codebase's convention
-- (e.g. Invoice.registrationScreenshotKey) and CLAUDE.md rule 6 (never return raw S3 URLs).
ALTER TABLE "Organization" RENAME COLUMN "logoUrl" TO "logoKey";
