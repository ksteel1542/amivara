-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('PAYSTACK', 'GOOGLE_PLAY');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'ABANDONED');

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "package_id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "reference" VARCHAR(100) NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN',
    "coins" INTEGER NOT NULL,
    "bonus_coins" INTEGER NOT NULL DEFAULT 0,
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "failure_reason" VARCHAR(64),
    "provider_transaction_id" VARCHAR(64),
    "channel" VARCHAR(32),
    "ledger_transaction_id" UUID,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_reference_key" ON "payment_intents"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_ledger_transaction_id_key" ON "payment_intents"("ledger_transaction_id");

-- CreateIndex
CREATE INDEX "payment_intents_user_id_created_at_idx" ON "payment_intents"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_intents_status_created_at_idx" ON "payment_intents"("status", "created_at");

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "coin_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_ledger_transaction_id_fkey" FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written (MONETIZATION_PLAN.md M2) ──

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_amount_chk" CHECK ("amount_kobo" > 0 AND "coins" > 0 AND "bonus_coins" >= 0),
  ADD CONSTRAINT "payment_intents_currency_chk" CHECK ("currency" = 'NGN'),
  -- A succeeded intent always points at the ledger transaction that credited it, and only then.
  ADD CONSTRAINT "payment_intents_succeeded_chk" CHECK (
    ("status" = 'SUCCEEDED') = ("ledger_transaction_id" IS NOT NULL)
    AND ("status" <> 'SUCCEEDED' OR "paid_at" IS NOT NULL)
  );
