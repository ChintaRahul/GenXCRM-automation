-- CreateTable
CREATE TABLE "NurturingSequence" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerEvent" TEXT NOT NULL DEFAULT 'manual',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NurturingSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NurturingStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NurturingStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NurturingEnrollment" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "NurturingEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NurturingStep_sequenceId_idx" ON "NurturingStep"("sequenceId");

-- CreateIndex
CREATE INDEX "NurturingEnrollment_leadId_idx" ON "NurturingEnrollment"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "NurturingEnrollment_sequenceId_leadId_key" ON "NurturingEnrollment"("sequenceId", "leadId");

-- AddForeignKey
ALTER TABLE "NurturingStep" ADD CONSTRAINT "NurturingStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "NurturingSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NurturingEnrollment" ADD CONSTRAINT "NurturingEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "NurturingSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NurturingEnrollment" ADD CONSTRAINT "NurturingEnrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
