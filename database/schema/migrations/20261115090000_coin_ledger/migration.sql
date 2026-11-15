-- CreateEnum
CREATE TYPE "ledger_account_kind" AS ENUM ('MEMBER_COINS_PAID', 'MEMBER_COINS_PROMO', 'MEMBER_EARNINGS_PENDING', 'MEMBER_EARNINGS_AVAILABLE', 'PLATFORM_REVENUE', 'PLATFORM_PROMO', 'PLATFORM_ADJUSTMENTS', 'GATEWAY_CLEARING', 'PAYOUT_CLEARING');

-- CreateEnum
CREATE TYPE "ledger_currency" AS ENUM ('COIN', 'NGN');

-- CreateEnum
CREATE TYPE "ledger_transaction_kind" AS ENUM ('STARTER_GRANT', 'TOPUP', 'SPEND', 'ADJUSTMENT', 'REFUND');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "kind" "ledger_account_kind" NOT NULL,
    "currency" "ledger_currency" NOT NULL DEFAULT 'COIN',
    "balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "kind" "ledger_transaction_kind" NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "user_id" UUID,
    "actor_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_packages" (
    "id" UUID NOT NULL,
    "coins" INTEGER NOT NULL,
    "price_kobo" BIGINT NOT NULL,
    "bonus_coins" INTEGER NOT NULL DEFAULT 0,
    "first_purchase_bonus" INTEGER NOT NULL DEFAULT 0,
    "play_product_id" VARCHAR(100),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coin_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_claims" (
    "id" UUID NOT NULL,
    "subject" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_owner_id_kind_key" ON "ledger_accounts"("owner_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key_key" ON "ledger_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_transactions_user_id_created_at_idx" ON "ledger_transactions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "coin_packages_play_product_id_key" ON "coin_packages"("play_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_claims_kind_subject_key" ON "promo_claims"("kind", "subject");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────── Hand-written (coin ledger, docs/MONETIZATION_PLAN.md) ───────────

-- Platform accounts have no owner and exist once per kind; member accounts belong to a member
-- (the owner becomes NULL only when the member is purged, keeping the financial history).
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_owner_kind_chk
  CHECK (kind NOT IN ('PLATFORM_REVENUE', 'PLATFORM_PROMO', 'PLATFORM_ADJUSTMENTS', 'GATEWAY_CLEARING', 'PAYOUT_CLEARING') OR owner_id IS NULL);
CREATE UNIQUE INDEX ledger_accounts_platform_kind_key ON ledger_accounts (kind)
  WHERE kind IN ('PLATFORM_REVENUE', 'PLATFORM_PROMO', 'PLATFORM_ADJUSTMENTS', 'GATEWAY_CLEARING', 'PAYOUT_CLEARING');
-- No overdraft, ever: a member balance can't go below zero (checked on every entry via the trigger below).
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_member_nonnegative_chk
  CHECK (kind IN ('PLATFORM_REVENUE', 'PLATFORM_PROMO', 'PLATFORM_ADJUSTMENTS', 'GATEWAY_CLEARING', 'PAYOUT_CLEARING') OR balance >= 0);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_nonzero_chk CHECK (amount <> 0);

-- The cached balance follows every entry, in the same statement (row lock = serialised spends).
CREATE FUNCTION ledger_apply_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ledger_accounts SET balance = balance + NEW.amount WHERE id = NEW.account_id;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_apply_entry AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_apply_entry();

-- Double entry: at commit, every transaction's entries sum to zero per currency.
CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
     WHERE e.transaction_id = NEW.transaction_id
     GROUP BY a.currency HAVING SUM(e.amount) <> 0
  ) THEN
    RAISE EXCEPTION 'ledger transaction % is not balanced', NEW.transaction_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_check_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- Append-only: corrections are new transactions, never edits.
CREATE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

ALTER TABLE coin_packages ADD CONSTRAINT coin_packages_amounts_chk
  CHECK (coins > 0 AND price_kobo > 0 AND bonus_coins >= 0 AND first_purchase_bonus >= 0);

-- Placeholder packages (prices to be confirmed: MONETIZATION_PLAN.md section 2, point 6).
INSERT INTO coin_packages (id, coins, price_kobo, bonus_coins, first_purchase_bonus, sort) VALUES
  (gen_random_uuid(),   500,  100000,    0,  100, 1),
  (gen_random_uuid(),  2000,  350000,  100,  400, 2),
  (gen_random_uuid(), 10000, 1500000, 1000, 2000, 3),
  (gen_random_uuid(), 30000, 4000000, 4000, 6000, 4);
