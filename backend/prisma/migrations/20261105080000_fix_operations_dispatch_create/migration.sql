-- Data fix: 20261104100000_operations_can_create_dispatch matched role = 'Operations', but RolePermission stores the enum value 'OPERATIONS', so it updated nothing.
UPDATE "RolePermission"
SET "canCreate" = true
WHERE "role" = 'OPERATIONS' AND "moduleKey" = 'dispatch' AND "isDeleted" = false;
