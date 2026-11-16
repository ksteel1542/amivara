-- AlterEnum
ALTER TYPE "message_type" ADD VALUE IF NOT EXISTS 'GIFT';

-- CreateTable
CREATE TABLE "gifts" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "price_coins" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_sends" (
    "id" UUID NOT NULL,
    "gift_id" UUID NOT NULL,
    "sender_id" UUID,
    "recipient_id" UUID,
    "match_id" UUID,
    "message_id" UUID,
    "coins" INTEGER NOT NULL,
    "host_earned" INTEGER NOT NULL DEFAULT 0,
    "ledger_transaction_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gifts_slug_key" ON "gifts"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "gift_sends_message_id_key" ON "gift_sends"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "gift_sends_ledger_transaction_id_key" ON "gift_sends"("ledger_transaction_id");

-- CreateIndex
CREATE INDEX "gift_sends_recipient_id_created_at_idx" ON "gift_sends"("recipient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "gift_sends_sender_id_created_at_idx" ON "gift_sends"("sender_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "gift_sends" ADD CONSTRAINT "gift_sends_gift_id_fkey" FOREIGN KEY ("gift_id") REFERENCES "gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_sends" ADD CONSTRAINT "gift_sends_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_sends" ADD CONSTRAINT "gift_sends_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_sends" ADD CONSTRAINT "gift_sends_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_sends" ADD CONSTRAINT "gift_sends_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Hand-written (MONETIZATION_PLAN.md 3b: gifts) ──

ALTER TABLE "gifts"
  ADD CONSTRAINT "gifts_price_chk" CHECK ("price_coins" > 0),
  ADD CONSTRAINT "gifts_slug_chk" CHECK ("slug" ~ '^[a-z0-9-]{1,32}$');

ALTER TABLE "gift_sends"
  ADD CONSTRAINT "gift_sends_coins_chk" CHECK ("coins" > 0),
  ADD CONSTRAINT "gift_sends_earned_chk" CHECK ("host_earned" >= 0 AND "host_earned" <= "coins"),
  ADD CONSTRAINT "gift_sends_parties_chk" CHECK ("sender_id" IS NULL OR "sender_id" <> "recipient_id");

-- Placeholder prices (16 Nov 2026), editable in this table: final prices are still to be set.
INSERT INTO "gifts" ("id", "slug", "name", "emoji", "price_coins", "sort") VALUES
  (gen_random_uuid(), 'rose',  'Rose',  '🌹', 20,   1),
  (gen_random_uuid(), 'kiss',  'Kiss',  '💋', 50,   2),
  (gen_random_uuid(), 'teddy', 'Teddy', '🧸', 200,  3),
  (gen_random_uuid(), 'crown', 'Crown', '👑', 1000, 4);

-- Gift messages carry no body or media: the gift is in gift_sends. (Compared as text:
-- the new enum value can't be used in the transaction that adds it.)
ALTER TABLE "messages" DROP CONSTRAINT "messages_content_chk";
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_chk"
  CHECK ("body" IS NOT NULL OR "media_key" IS NOT NULL OR "type"::text = 'GIFT');
