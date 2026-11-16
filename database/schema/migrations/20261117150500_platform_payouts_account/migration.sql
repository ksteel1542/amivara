-- PLATFORM_PAYOUTS (added in the previous migration) is a platform account like the
-- others: no owner, one per kind, and allowed below zero (a settled payout the bank
-- later reverses is re-credited to the Host from it).
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_owner_kind_chk;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_owner_kind_chk
  CHECK (kind NOT IN ('PLATFORM_REVENUE', 'PLATFORM_PROMO', 'PLATFORM_ADJUSTMENTS', 'GATEWAY_CLEARING', 'PAYOUT_CLEARING', 'PLATFORM_PAYOUTS') OR owner_id IS NULL);
DROP INDEX ledger_accounts_platform_kind_key;
CREATE UNIQUE INDEX ledger_accounts_platform_kind_key ON ledger_accounts (kind)
  WHERE kind IN ('PLATFORM_REVENUE', 'PLATFORM_PROMO', 'PLATFORM_ADJUSTMENTS', 'GATEWAY_CLEARING', 'PAYOUT_CLEARING', 'PLATFORM_PAYOUTS');
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_member_nonnegative_chk;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_member_nonnegative_chk
  CHECK (kind IN ('PLATFORM_REVENUE', 'PLATFORM_PROMO', 'PLATFORM_ADJUSTMENTS', 'GATEWAY_CLEARING', 'PAYOUT_CLEARING', 'PLATFORM_PAYOUTS') OR balance >= 0);
