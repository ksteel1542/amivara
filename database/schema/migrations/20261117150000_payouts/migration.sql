-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED');

-- AlterEnum
ALTER TYPE "ledger_account_kind" ADD VALUE IF NOT EXISTS 'PLATFORM_PAYOUTS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ledger_transaction_kind" ADD VALUE IF NOT EXISTS 'PAYOUT';
ALTER TYPE "ledger_transaction_kind" ADD VALUE IF NOT EXISTS 'PAYOUT_SETTLED';
ALTER TYPE "ledger_transaction_kind" ADD VALUE IF NOT EXISTS 'PAYOUT_RETURN';

-- CreateTable
CREATE TABLE "payout_accounts" (
    "user_id" UUID NOT NULL,
    "bank_code" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number_enc" TEXT NOT NULL,
    "account_last4" CHAR(4) NOT NULL,
    "account_name" TEXT NOT NULL,
    "recipient_code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "coins" INTEGER NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "status" "payout_status" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT NOT NULL,
    "transfer_code" TEXT,
    "failure_reason" TEXT,
    "bank_name" TEXT NOT NULL,
    "account_last4" CHAR(4) NOT NULL,
    "account_name" TEXT NOT NULL,
    "ledger_transaction_id" UUID NOT NULL,
    "settle_transaction_id" UUID,
    "return_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_reference_key" ON "payouts"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_ledger_transaction_id_key" ON "payouts"("ledger_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_settle_transaction_id_key" ON "payouts"("settle_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_return_transaction_id_key" ON "payouts"("return_transaction_id");

-- CreateIndex
CREATE INDEX "payouts_user_id_created_at_idx" ON "payouts"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payouts_status_created_at_idx" ON "payouts"("status", "created_at");

-- AddForeignKey
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Hand-written (MONETIZATION_PLAN.md M7/M8: payouts) ──
-- (Ledger constraints for the new PLATFORM_PAYOUTS account follow in the next
-- migration: a new enum value can't be used in the transaction that adds it.)

ALTER TABLE "payout_accounts"
  ADD CONSTRAINT "payout_accounts_last4_chk" CHECK ("account_last4" ~ '^[0-9]{4}$');

ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_amount_chk" CHECK ("coins" > 0 AND "amount_kobo" > 0),
  ADD CONSTRAINT "payouts_last4_chk" CHECK ("account_last4" ~ '^[0-9]{4}$'),
  ADD CONSTRAINT "payouts_done_chk" CHECK (("status" = 'PENDING') = ("completed_at" IS NULL)),
  ADD CONSTRAINT "payouts_settled_chk" CHECK ("status" <> 'SUCCESS' OR "settle_transaction_id" IS NOT NULL),
  ADD CONSTRAINT "payouts_returned_chk" CHECK ("status" NOT IN ('FAILED', 'REVERSED') OR "return_transaction_id" IS NOT NULL);

-- One payout in flight per Host: the same available balance can't be withdrawn twice.
CREATE UNIQUE INDEX "payouts_one_pending_per_user_key" ON "payouts"("user_id") WHERE "status" = 'PENDING';
