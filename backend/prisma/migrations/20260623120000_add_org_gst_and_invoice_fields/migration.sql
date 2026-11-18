-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "gstNumber" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "includeGstNumber" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "invoiceNumber" TEXT,
ADD COLUMN "invoiceSentAt" TIMESTAMP(3);
