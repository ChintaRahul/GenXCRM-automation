-- Quotation: number stamped from the org's 'Quotation…' document template.
ALTER TABLE "Quotation" ADD COLUMN "documentNo" TEXT;

-- Opportunity: competitor details captured when a deal is marked lost.
ALTER TABLE "Opportunity" ADD COLUMN "competitorProduct" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN "competitorPrice" DOUBLE PRECISION;
ALTER TABLE "Opportunity" ADD COLUMN "decisionDate" TIMESTAMP(3);
ALTER TABLE "Opportunity" ADD COLUMN "lostFeedback" TEXT;
