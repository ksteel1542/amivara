-- CreateEnum
CREATE TYPE "call_type" AS ENUM ('VOICE', 'VIDEO');

-- CreateEnum
CREATE TYPE "call_status" AS ENUM ('RINGING', 'ACTIVE', 'ENDED', 'DECLINED', 'MISSED', 'CANCELLED', 'INSUFFICIENT_COINS');

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "caller_id" UUID NOT NULL,
    "callee_id" UUID NOT NULL,
    "type" "call_type" NOT NULL,
    "status" "call_status" NOT NULL DEFAULT 'RINGING',
    "rate_per_minute" INTEGER NOT NULL,
    "ring_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "next_bill_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "billed_minutes" INTEGER NOT NULL DEFAULT 0,
    "total_coins_billed" INTEGER NOT NULL DEFAULT 0,
    "end_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_sessions_status_ring_expires_at_idx" ON "call_sessions"("status", "ring_expires_at");

-- CreateIndex
CREATE INDEX "call_sessions_status_next_bill_at_idx" ON "call_sessions"("status", "next_bill_at");

-- CreateIndex
CREATE INDEX "call_sessions_caller_id_created_at_idx" ON "call_sessions"("caller_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "call_sessions_callee_id_created_at_idx" ON "call_sessions"("callee_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "call_sessions_match_id_created_at_idx" ON "call_sessions"("match_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_caller_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_callee_id_fkey" FOREIGN KEY ("callee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written (MONETIZATION_PLAN.md M4/M5) ──

ALTER TABLE "call_sessions"
  ADD CONSTRAINT "call_sessions_parties_chk" CHECK ("caller_id" <> "callee_id"),
  ADD CONSTRAINT "call_sessions_rate_chk" CHECK ("rate_per_minute" >= 0),
  ADD CONSTRAINT "call_sessions_billing_chk" CHECK (
    "billed_minutes" >= 0 AND "total_coins_billed" = "billed_minutes" * "rate_per_minute"),
  -- Answered calls have a start, unanswered ones never do. INSUFFICIENT_COINS can be
  -- either: the caller's coins can run out on answering (first minute) or mid-call.
  ADD CONSTRAINT "call_sessions_started_chk" CHECK (
    ("status" NOT IN ('ACTIVE', 'ENDED') OR "started_at" IS NOT NULL)
    AND ("status" NOT IN ('RINGING', 'DECLINED', 'MISSED', 'CANCELLED') OR "started_at" IS NULL)),
  -- Live calls have no end; finished calls do.
  ADD CONSTRAINT "call_sessions_ended_chk" CHECK (
    ("status" IN ('RINGING', 'ACTIVE')) = ("ended_at" IS NULL)),
  ADD CONSTRAINT "call_sessions_next_bill_chk" CHECK (
    "next_bill_at" IS NULL OR ("status" = 'ACTIVE' AND "rate_per_minute" > 0));

-- A member is in at most one live call at a time on each side. CallsService also
-- locks both members, so nobody can be caller in one live call and callee in another.
CREATE UNIQUE INDEX "call_sessions_live_caller_key" ON "call_sessions"("caller_id")
  WHERE "status" IN ('RINGING', 'ACTIVE');
CREATE UNIQUE INDEX "call_sessions_live_callee_key" ON "call_sessions"("callee_id")
  WHERE "status" IN ('RINGING', 'ACTIVE');
