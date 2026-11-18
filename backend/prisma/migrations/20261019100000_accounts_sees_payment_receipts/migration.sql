-- Accounts owns payments: it must not be restricted from the 'Payment receipts' field-security toggle.
UPDATE "FieldPermission"
SET "restrictedToRoles" = array_remove("restrictedToRoles", 'ACCOUNTS')
WHERE "fieldLabel" = 'Payment receipts' AND "moduleKey" = 'payments';
