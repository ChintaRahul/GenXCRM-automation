-- Invoice numbers must be unique per organization: generateInvoiceNumber() derives the next
-- number from a COUNT, so concurrent creates could otherwise persist the same number twice.
-- The unique index also replaces the previous non-unique lookup index on the same columns.

-- DropIndex
DROP INDEX "Invoice_orgId_invoiceNumber_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orgId_invoiceNumber_key" ON "Invoice"("orgId", "invoiceNumber");
