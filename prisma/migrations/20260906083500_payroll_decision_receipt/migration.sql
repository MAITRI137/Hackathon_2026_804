CREATE TABLE "PayrollDecisionReceipt" (
    "id" TEXT NOT NULL,
    "payrunId" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "readinessScore" INTEGER NOT NULL,
    "blockingExceptionCount" INTEGER NOT NULL,
    "employeeCount" INTEGER NOT NULL,
    "netTotal" DECIMAL(18,2) NOT NULL,
    "preparedById" TEXT NOT NULL,
    "preparedByName" TEXT NOT NULL,
    "preparedAt" TIMESTAMPTZ(3) NOT NULL,
    "validatedById" TEXT,
    "validatedByName" TEXT,
    "validatedAt" TIMESTAMPTZ(3),
    "paidById" TEXT,
    "paidByName" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PayrollDecisionReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollDecisionReceipt_payrunId_key" ON "PayrollDecisionReceipt"("payrunId");

ALTER TABLE "PayrollDecisionReceipt"
  ADD CONSTRAINT "PayrollDecisionReceipt_payrunId_fkey"
  FOREIGN KEY ("payrunId") REFERENCES "Payrun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
