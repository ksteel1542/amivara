-- CreateEnum
CREATE TYPE "match_source" AS ENUM ('MUTUAL', 'HOST_DIRECT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "accepted_terms_at" TIMESTAMPTZ(6),
ADD COLUMN     "allow_call_invites" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "source" "match_source" NOT NULL DEFAULT 'MUTUAL';

-- AlterTable
ALTER TABLE "call_sessions" ADD COLUMN     "is_invite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payer_id" UUID,
ADD COLUMN     "preview_seconds" INTEGER NOT NULL DEFAULT 0;


-- ── Hand-written (lower-friction onboarding, 17 Nov 2026) ──

-- Calls billed before this change were paid by the caller.
UPDATE "call_sessions" SET "payer_id" = "caller_id" WHERE "rate_per_minute" > 0;

ALTER TABLE "call_sessions"
  ADD CONSTRAINT "call_sessions_payer_chk" CHECK (("rate_per_minute" > 0) = ("payer_id" IS NOT NULL)),
  ADD CONSTRAINT "call_sessions_payer_party_chk" CHECK ("payer_id" IS NULL OR "payer_id" IN ("caller_id", "callee_id")),
  ADD CONSTRAINT "call_sessions_preview_chk" CHECK ("preview_seconds" BETWEEN 0 AND 60);

CREATE INDEX "call_sessions_invites_idx" ON "call_sessions"("callee_id", "created_at" DESC) WHERE "is_invite";
