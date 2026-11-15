-- CreateEnum
CREATE TYPE "host_status" AS ENUM ('ACTIVE', 'PAUSED');

-- AlterEnum
ALTER TYPE "ledger_transaction_kind" ADD VALUE 'EARNINGS_RELEASE';

-- CreateTable
CREATE TABLE "host_profiles" (
    "user_id" UUID NOT NULL,
    "status" "host_status" NOT NULL DEFAULT 'ACTIVE',
    "revenue_share_bps" INTEGER NOT NULL,
    "earning_since" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paused_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "host_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "host_earnings" (
    "id" UUID NOT NULL,
    "host_id" UUID,
    "ledger_transaction_id" UUID NOT NULL,
    "coins" INTEGER NOT NULL,
    "available_at" TIMESTAMPTZ(6) NOT NULL,
    "release_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "host_earnings_ledger_transaction_id_key" ON "host_earnings"("ledger_transaction_id");

-- CreateIndex
CREATE INDEX "host_earnings_release_transaction_id_available_at_idx" ON "host_earnings"("release_transaction_id", "available_at");

-- CreateIndex
CREATE INDEX "host_earnings_host_id_created_at_idx" ON "host_earnings"("host_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "host_profiles" ADD CONSTRAINT "host_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_earnings" ADD CONSTRAINT "host_earnings_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_earnings" ADD CONSTRAINT "host_earnings_ledger_transaction_id_fkey" FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_earnings" ADD CONSTRAINT "host_earnings_release_transaction_id_fkey" FOREIGN KEY ("release_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written (MONETIZATION_PLAN.md M3) ──

ALTER TABLE "host_profiles"
  ADD CONSTRAINT "host_profiles_share_chk" CHECK ("revenue_share_bps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "host_profiles_paused_chk" CHECK (("status" = 'PAUSED') = ("paused_at" IS NOT NULL));

ALTER TABLE "host_earnings"
  ADD CONSTRAINT "host_earnings_coins_chk" CHECK ("coins" > 0);

-- Unreleased earnings, oldest first: what the release job scans.
CREATE INDEX "host_earnings_due_idx" ON "host_earnings" ("available_at") WHERE "release_transaction_id" IS NULL;
