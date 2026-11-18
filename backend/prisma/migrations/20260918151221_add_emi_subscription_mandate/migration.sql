-- CreateEnum
CREATE TYPE "EmiPaymentMode" AS ENUM ('MANUAL', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "EmiMandateStatus" AS ENUM ('CREATED', 'AUTHENTICATED', 'ACTIVE', 'HALTED', 'CANCELLED', 'COMPLETED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "emiPaymentMode" "EmiPaymentMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "emiGatewaySubscriptionId" TEXT,
ADD COLUMN "emiMandateStatus" "EmiMandateStatus",
ADD COLUMN "emiMandateShortUrl" TEXT;
