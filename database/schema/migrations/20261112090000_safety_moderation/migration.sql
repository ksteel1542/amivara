-- CreateEnum
CREATE TYPE "report_category" AS ENUM ('FAKE_PROFILE', 'UNDERAGE', 'HARASSMENT', 'SCAM', 'EXPLICIT_CONTENT', 'HATE', 'OTHER');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "report_priority" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL');

-- CreateEnum
CREATE TYPE "enforcement_action_type" AS ENUM ('WARN', 'SUSPEND', 'BAN', 'UNBAN');

-- AlterEnum
ALTER TYPE "signup_block_reason" ADD VALUE 'BANNED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "suspended_until" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "device_sessions" ADD COLUMN     "device_hash" VARCHAR(64);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reported_id" UUID NOT NULL,
    "category" "report_category" NOT NULL,
    "details" VARCHAR(1000),
    "message_id" UUID,
    "match_id" UUID,
    "evidence" TEXT NOT NULL,
    "status" "report_status" NOT NULL DEFAULT 'OPEN',
    "priority" "report_priority" NOT NULL DEFAULT 'NORMAL',
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "resolution" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enforcement_actions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" "enforcement_action_type" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "actor_id" UUID,
    "report_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enforcement_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "target_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_status_priority_created_at_idx" ON "reports"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "reports_reported_id_idx" ON "reports"("reported_id");

-- CreateIndex
CREATE INDEX "reports_reporter_id_created_at_idx" ON "reports"("reporter_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "enforcement_actions_user_id_created_at_idx" ON "enforcement_actions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_created_at_idx" ON "audit_log"("target_type", "target_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────── Hand-written (Stage 5: trust & safety) ───────────

-- Nobody can report themselves.
ALTER TABLE reports ADD CONSTRAINT reports_not_self_chk CHECK (reporter_id <> reported_id);
-- Suspensions are explained; a temporary one has an end.
ALTER TABLE enforcement_actions ADD CONSTRAINT enforcement_actions_reason_chk CHECK (char_length(btrim(reason)) > 0);
ALTER TABLE enforcement_actions ADD CONSTRAINT enforcement_actions_expiry_chk
  CHECK (expires_at IS NULL OR action = 'SUSPEND');

-- Evidence is immutable: what the reporter saw when they filed is what moderators see.
CREATE FUNCTION reports_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.evidence IS DISTINCT FROM OLD.evidence
     OR NEW.reporter_id IS DISTINCT FROM OLD.reporter_id
     OR NEW.reported_id IS DISTINCT FROM OLD.reported_id
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.details IS DISTINCT FROM OLD.details
     OR NEW.message_id IS DISTINCT FROM OLD.message_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'reports: the filed report and its evidence are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reports_evidence_immutable BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION reports_evidence_immutable();

-- The audit log is append-only.
CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
