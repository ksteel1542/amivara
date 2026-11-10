-- CreateEnum
CREATE TYPE "otp_channel" AS ENUM ('SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "signup_block_reason" AS ENUM ('UNDERAGE');

-- CreateTable
CREATE TABLE "preferences" (
    "user_id" UUID NOT NULL,
    "interested_in" "gender"[],
    "age_min" SMALLINT NOT NULL,
    "age_max" SMALLINT NOT NULL,
    "max_distance_km" SMALLINT NOT NULL DEFAULT 50,
    "intents" "intent"[] DEFAULT ARRAY[]::"intent"[],
    "show_me_in_discovery" BOOLEAN NOT NULL DEFAULT true,
    "incognito" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "channel" "otp_channel" NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "ip_hash" VARCHAR(64),
    "device_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(64) NOT NULL,
    "platform" VARCHAR(16),
    "device_model" VARCHAR(100),
    "ip_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_id" UUID,

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signup_blocks" (
    "id" UUID NOT NULL,
    "subject" VARCHAR(64) NOT NULL,
    "reason" "signup_block_reason" NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_challenges_phone_e164_created_at_idx" ON "otp_challenges"("phone_e164", "created_at" DESC);

-- CreateIndex
CREATE INDEX "otp_challenges_device_hash_created_at_idx" ON "otp_challenges"("device_hash", "created_at" DESC);

-- CreateIndex
CREATE INDEX "otp_challenges_ip_hash_created_at_idx" ON "otp_challenges"("ip_hash", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "device_sessions_refresh_token_hash_key" ON "device_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "device_sessions_user_id_revoked_at_idx" ON "device_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "device_sessions_family_id_idx" ON "device_sessions"("family_id");

-- CreateIndex
CREATE INDEX "signup_blocks_subject_expires_at_idx" ON "signup_blocks"("subject", "expires_at");

-- AddForeignKey
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written constraints (kept in sync with schema.prisma, bottom).
-- ─────────────────────────────────────────────────────────────────────────

-- Nobody can ever set an age range below 18 (PRD §4).
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_age_chk"
  CHECK ("age_min" >= 18 AND "age_max" >= "age_min" AND "age_max" <= 99);
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_distance_chk"
  CHECK ("max_distance_km" BETWEEN 1 AND 300);
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_interested_in_chk"
  CHECK (cardinality("interested_in") >= 1);

-- OTP attempts are capped at 5 by the API; the database refuses anything absurd.
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_attempts_chk"
  CHECK ("attempts" BETWEEN 0 AND 10);
