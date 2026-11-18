-- CreateEnum
CREATE TYPE "AddonStatus" AS ENUM ('PENDING', 'PAID');

-- AlterTable
ALTER TABLE "SubscriptionAddon" ADD COLUMN     "razorpayPaymentLinkId" TEXT,
ADD COLUMN     "status" "AddonStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionAddon_razorpayPaymentLinkId_key" ON "SubscriptionAddon"("razorpayPaymentLinkId");
