-- Data-only: approvals auto-created from a quotation / costing sheet embedded the full record UUID in
-- their title. New ones use the short code (QT-933B51 / CS-69F94A); rewrite the old titles to match.
UPDATE "Approval"
SET "title" = 'Quotation approval — QT-' || upper(left(replace("entityId", '-', ''), 6))
WHERE "entityType" = 'Quotation' AND "title" = 'Quotation approval — ' || "entityId";

UPDATE "Approval"
SET "title" = 'Costing approval — CS-' || upper(left(replace("entityId", '-', ''), 6))
WHERE "entityType" = 'Costing' AND "title" = 'Costing approval — ' || "entityId";
