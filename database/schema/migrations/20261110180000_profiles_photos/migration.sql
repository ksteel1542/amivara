-- CreateEnum
CREATE TYPE "photo_status" AS ENUM ('PENDING_UPLOAD', 'UPLOADED');

-- CreateTable
CREATE TABLE "profile_photos" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" VARCHAR(32) NOT NULL,
    "size_bytes" INTEGER,
    "status" "photo_status" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "position" SMALLINT,
    "moderation_status" "moderation_status" NOT NULL DEFAULT 'PENDING',
    "face_match_score" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_at" TIMESTAMPTZ(6),

    CONSTRAINT "profile_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profile_photos_storage_key_key" ON "profile_photos"("storage_key");

-- CreateIndex
CREATE INDEX "profile_photos_user_id_status_idx" ON "profile_photos"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "profile_photos_user_id_position_key" ON "profile_photos"("user_id", "position");

-- AddForeignKey
ALTER TABLE "profile_photos" ADD CONSTRAINT "profile_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written constraints (kept in sync with schema.prisma, bottom).
-- ─────────────────────────────────────────────────────────────────────────

-- Profile content limits.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_prompts_chk"
  CHECK (jsonb_typeof("prompts") = 'array' AND jsonb_array_length("prompts") <= 5);
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_languages_chk"
  CHECK (cardinality("languages") <= 8);
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_bio_chk"
  CHECK ("bio" IS NULL OR char_length(btrim("bio")) > 0);

-- Photos: six slots (positions 0-5, 0 = primary), JPEG/WebP only.
ALTER TABLE "profile_photos" ADD CONSTRAINT "profile_photos_position_chk"
  CHECK ("position" IS NULL OR "position" BETWEEN 0 AND 5);
-- Pending uploads never hold a slot. (Uploaded photos may be NULL only inside
-- the reorder transaction: the unique index is checked row by row.)
ALTER TABLE "profile_photos" ADD CONSTRAINT "profile_photos_pending_position_chk"
  CHECK ("status" = 'UPLOADED' OR "position" IS NULL);
ALTER TABLE "profile_photos" ADD CONSTRAINT "profile_photos_content_type_chk"
  CHECK ("content_type" IN ('image/jpeg', 'image/webp'));
