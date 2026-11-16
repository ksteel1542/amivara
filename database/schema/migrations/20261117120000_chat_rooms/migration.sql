-- CreateEnum
CREATE TYPE "room_mode" AS ENUM ('AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "room_audience" AS ENUM ('OPEN', 'FOLLOWERS');

-- CreateEnum
CREATE TYPE "room_status" AS ENUM ('LIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "room_role" AS ENUM ('HOST', 'SPEAKER', 'LISTENER');

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "room_id" UUID;

-- AlterTable
ALTER TABLE "gift_sends" ADD COLUMN     "room_id" UUID;

-- CreateTable
CREATE TABLE "host_follows" (
    "follower_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_follows_pkey" PRIMARY KEY ("follower_id","host_id")
);

-- CreateTable
CREATE TABLE "chat_rooms" (
    "id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "mode" "room_mode" NOT NULL,
    "audience" "room_audience" NOT NULL DEFAULT 'OPEN',
    "status" "room_status" NOT NULL DEFAULT 'LIVE',
    "max_seats" INTEGER NOT NULL DEFAULT 8,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "end_reason" TEXT,

    CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_participants" (
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "room_role" NOT NULL DEFAULT 'LISTENER',
    "seat_requested_at" TIMESTAMPTZ(6),
    "muted_by_host" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(6),

    CONSTRAINT "room_participants_pkey" PRIMARY KEY ("room_id","user_id")
);

-- CreateTable
CREATE TABLE "room_messages" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_bans" (
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_bans_pkey" PRIMARY KEY ("room_id","user_id")
);

-- CreateIndex
CREATE INDEX "host_follows_host_id_idx" ON "host_follows"("host_id");

-- CreateIndex
CREATE INDEX "chat_rooms_status_started_at_idx" ON "chat_rooms"("status", "started_at" DESC);

-- CreateIndex
CREATE INDEX "chat_rooms_host_id_started_at_idx" ON "chat_rooms"("host_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "room_participants_user_id_idx" ON "room_participants"("user_id");

-- CreateIndex
CREATE INDEX "room_messages_room_id_created_at_idx" ON "room_messages"("room_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "host_follows" ADD CONSTRAINT "host_follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_follows" ADD CONSTRAINT "host_follows_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_sends" ADD CONSTRAINT "gift_sends_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Hand-written (MONETIZATION_PLAN.md 3b: Chat House rooms) ──

ALTER TABLE "host_follows" ADD CONSTRAINT "host_follows_self_chk" CHECK ("follower_id" <> "host_id");

ALTER TABLE "chat_rooms"
  ADD CONSTRAINT "chat_rooms_seats_chk" CHECK ("max_seats" BETWEEN 0 AND 8),
  ADD CONSTRAINT "chat_rooms_title_chk" CHECK (length(btrim("title")) BETWEEN 1 AND 80),
  ADD CONSTRAINT "chat_rooms_ended_chk" CHECK (("status" = 'ENDED') = ("ended_at" IS NOT NULL));

-- A Host runs at most one live room at a time.
CREATE UNIQUE INDEX "chat_rooms_one_live_per_host_key" ON "chat_rooms"("host_id") WHERE "status" = 'LIVE';

ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_body_chk" CHECK (length("body") > 0);

-- A gift goes to a chat or a room, never both.
ALTER TABLE "gift_sends" ADD CONSTRAINT "gift_sends_place_chk" CHECK ("match_id" IS NULL OR "room_id" IS NULL);
