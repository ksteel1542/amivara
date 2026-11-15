-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "verification_type" ADD VALUE 'EMAIL_OTP';
ALTER TYPE "verification_type" ADD VALUE 'GOOGLE';

-- AlterEnum
ALTER TYPE "otp_channel" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email" VARCHAR(254),
ADD COLUMN     "email_verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "guidelines_accepted_at" TIMESTAMPTZ(6),
ALTER COLUMN "phone_e164" DROP NOT NULL;

-- AlterTable
ALTER TABLE "otp_challenges" ADD COLUMN     "email" VARCHAR(254),
ALTER COLUMN "phone_e164" DROP NOT NULL;

-- CreateTable
CREATE TABLE "safety_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "signals" TEXT[],
    "match_id" UUID,
    "message_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "safety_events_user_id_created_at_idx" ON "safety_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "safety_events_kind_created_at_idx" ON "safety_events"("kind", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "otp_challenges_email_created_at_idx" ON "otp_challenges"("email", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────── Hand-written (email-first sign-up) ───────────

-- Every member has a way to sign in: a phone number or an email address.
ALTER TABLE users ADD CONSTRAINT users_identity_chk CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL);
-- Emails are stored lower-cased, so the unique index is case-insensitive in practice.
ALTER TABLE users ADD CONSTRAINT users_email_lower_chk CHECK (email IS NULL OR email = lower(email));
-- A code goes to exactly one destination.
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_destination_chk
  CHECK ((phone_e164 IS NULL) <> (email IS NULL));
ALTER TABLE safety_events ADD CONSTRAINT safety_events_kind_chk CHECK (kind IN ('CONTACT_SHARING'));
