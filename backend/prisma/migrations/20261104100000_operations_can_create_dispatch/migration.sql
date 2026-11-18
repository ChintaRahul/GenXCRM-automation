-- Data fix: the Operations role owns dispatch, so it must be able to create dispatch records.
-- Updates existing orgs' seeded permission rows; new orgs get this from manufacturing-defaults.data.ts.
UPDATE "RolePermission"
SET "canCreate" = true
WHERE "role" = 'Operations' AND "moduleKey" = 'dispatch' AND "isDeleted" = false;
