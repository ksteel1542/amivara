-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'PAUSED', 'SUSPENDED', 'BANNED', 'PENDING_DELETION');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('MEMBER', 'MODERATOR', 'SENIOR_MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('WOMAN', 'MAN', 'NON_BINARY');

-- CreateEnum
CREATE TYPE "intent" AS ENUM ('RELATIONSHIP', 'FRIENDSHIP', 'CASUAL', 'NOT_SURE');

-- CreateEnum
CREATE TYPE "verification_type" AS ENUM ('PHONE_OTP', 'BIOMETRIC_KYC', 'DOCUMENT_VERIFICATION', 'SMART_SELFIE');

-- CreateEnum
CREATE TYPE "verification_provider" AS ENUM ('SMILE_ID', 'INTERNAL');

-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'MANUAL_REVIEW', 'EXPIRED');

-- CreateEnum
CREATE TYPE "message_type" AS ENUM ('TEXT', 'IMAGE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "moderation_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "phone_verified_at" TIMESTAMPTZ(6),
    "date_of_birth" DATE NOT NULL,
    "age_verified" BOOLEAN NOT NULL DEFAULT false,
    "age_verified_at" TIMESTAMPTZ(6),
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "role" "user_role" NOT NULL DEFAULT 'MEMBER',
    "last_active_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "user_id" UUID NOT NULL,
    "first_name" VARCHAR(50) NOT NULL,
    "gender" "gender" NOT NULL,
    "bio" VARCHAR(500),
    "intent" "intent" NOT NULL,
    "city" VARCHAR(100),
    "height_cm" SMALLINT,
    "education" VARCHAR(100),
    "job_title" VARCHAR(100),
    "religion" VARCHAR(50),
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prompts" JSONB NOT NULL DEFAULT '[]',
    "completeness_score" SMALLINT NOT NULL DEFAULT 0,
    "location" geography(Point, 4326),
    "geohash5" VARCHAR(5),
    "location_updated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "verification_type" NOT NULL,
    "provider" "verification_provider" NOT NULL DEFAULT 'SMILE_ID',
    "status" "verification_status" NOT NULL DEFAULT 'PENDING',
    "provider_job_id" TEXT,
    "provider_ref" TEXT,
    "result_code" VARCHAR(16),
    "result_text" VARCHAR(255),
    "id_type" VARCHAR(32),
    "verified_age_band" VARCHAR(8),
    "verified_adult" BOOLEAN,
    "dob_matches" BOOLEAN,
    "failure_reason" VARCHAR(255),
    "attempt" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "user_a_id" UUID NOT NULL,
    "user_b_id" UUID NOT NULL,
    "photos_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unmatched_at" TIMESTAMPTZ(6),
    "unmatched_by" UUID,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "type" "message_type" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "media_key" TEXT,
    "moderation_status" "moderation_status" NOT NULL DEFAULT 'APPROVED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_e164_key" ON "users"("phone_e164");

-- CreateIndex
CREATE INDEX "users_status_age_verified_idx" ON "users"("status", "age_verified");

-- CreateIndex
CREATE INDEX "users_last_active_at_idx" ON "users"("last_active_at");

-- CreateIndex
CREATE INDEX "profiles_location_gist_idx" ON "profiles" USING GIST ("location");

-- CreateIndex
CREATE INDEX "profiles_geohash5_idx" ON "profiles"("geohash5");

-- CreateIndex
CREATE INDEX "profiles_gender_idx" ON "profiles"("gender");

-- CreateIndex
CREATE UNIQUE INDEX "verifications_provider_job_id_key" ON "verifications"("provider_job_id");

-- CreateIndex
CREATE INDEX "verifications_user_id_type_created_at_idx" ON "verifications"("user_id", "type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "verifications_status_idx" ON "verifications"("status");

-- CreateIndex
CREATE INDEX "matches_user_b_id_idx" ON "matches"("user_b_id");

-- CreateIndex
CREATE INDEX "matches_last_message_at_idx" ON "matches"("last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "matches_user_a_id_user_b_id_key" ON "matches"("user_a_id", "user_b_id");

-- CreateIndex
CREATE INDEX "messages_match_id_created_at_idx" ON "messages"("match_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_sender_id_idx" ON "messages"("sender_id");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_unmatched_by_fkey" FOREIGN KEY ("unmatched_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written constraints Prisma cannot express (schema.prisma, bottom).
-- Keep these in sync with the "Raw SQL requirements" block in schema.prisma.
-- ─────────────────────────────────────────────────────────────────────────

-- 18+ at the database level (PRD §4, SECURITY.md §1). Evaluated on every
-- insert and update, so no row can ever hold a date of birth under 18.
ALTER TABLE "users" ADD CONSTRAINT "users_adult_chk"
  CHECK ("date_of_birth" <= (CURRENT_DATE - INTERVAL '18 years'));

-- Canonical pair ordering, so each pair can only ever match once.
ALTER TABLE "matches" ADD CONSTRAINT "matches_pair_order_chk"
  CHECK ("user_a_id" < "user_b_id");

-- A message must have either a body or media.
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_chk"
  CHECK ("body" IS NOT NULL OR "media_key" IS NOT NULL);

-- Profile bounds.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_height_chk"
  CHECK ("height_cm" IS NULL OR "height_cm" BETWEEN 120 AND 230);
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_interests_chk"
  CHECK (cardinality("interests") <= 10);
