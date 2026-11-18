-- CreateTable
CREATE TABLE "WhatsAppGlobalConversation" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppGlobalConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppGlobalConversation_phone_key" ON "WhatsAppGlobalConversation"("phone");

-- CreateIndex
CREATE INDEX "WhatsAppGlobalConversation_orgId_idx" ON "WhatsAppGlobalConversation"("orgId");

-- CreateIndex
CREATE INDEX "WhatsAppGlobalConversation_leadId_idx" ON "WhatsAppGlobalConversation"("leadId");

-- AddForeignKey
ALTER TABLE "WhatsAppGlobalConversation" ADD CONSTRAINT "WhatsAppGlobalConversation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppGlobalConversation" ADD CONSTRAINT "WhatsAppGlobalConversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
