-- CreateEnum
CREATE TYPE "ai_message_role" AS ENUM ('MEMBER', 'COMPANION');

-- CreateTable
CREATE TABLE "ai_personas" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "display_name" VARCHAR(40) NOT NULL,
    "tagline" VARCHAR(120) NOT NULL,
    "bio" VARCHAR(500) NOT NULL,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "persona_prompt" TEXT NOT NULL,
    "greeting" VARCHAR(500) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "ai_message_role" NOT NULL,
    "body" TEXT NOT NULL,
    "coins_charged" INTEGER NOT NULL DEFAULT 0,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "filtered" BOOLEAN NOT NULL DEFAULT false,
    "reported_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spend_limits" (
    "user_id" UUID NOT NULL,
    "ai_daily_cap_coins" INTEGER,
    "self_excluded_until" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "spend_limits_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_personas_slug_key" ON "ai_personas"("slug");

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_last_message_at_idx" ON "ai_conversations"("user_id", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversations_user_id_persona_id_key" ON "ai_conversations"("user_id", "persona_id");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "ai_personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_limits" ADD CONSTRAINT "spend_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written (MONETIZATION_PLAN.md M3b) ──

ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_coins_chk" CHECK ("coins_charged" >= 0);
ALTER TABLE "spend_limits" ADD CONSTRAINT "spend_limits_cap_chk" CHECK ("ai_daily_cap_coins" IS NULL OR "ai_daily_cap_coins" BETWEEN 0 AND 100000);
-- Every greeting discloses that it's an AI (also enforced by the API's tests).
ALTER TABLE "ai_personas" ADD CONSTRAINT "ai_personas_greeting_discloses_chk" CHECK ("greeting" ILIKE '%AI Companion%');

-- Four starter personas. No photos of real-looking people: the app shows an illustrated AI avatar.
INSERT INTO "ai_personas" ("id", "slug", "display_name", "tagline", "bio", "interests", "persona_prompt", "greeting", "sort") VALUES
  (gen_random_uuid(), 'ada', 'Ada', 'Bookworm and late-night philosopher',
   'An AI Companion who loves novels, poetry and long conversations about life in Lagos.',
   ARRAY['reading', 'poetry', 'writing', 'podcasts'],
   'You are Ada, a warm, thoughtful AI companion who loves books, poetry and deep conversations. You are curious about the member''s day and opinions, recommend books (especially Nigerian and African authors) and ask open questions. Your tone is gentle, witty and encouraging.',
   'Hi, I''m Ada, an AI Companion (not a real person). I love books and good conversation. What are you reading or thinking about lately?', 1),
  (gen_random_uuid(), 'tolu', 'Tolu', 'Foodie with strong jollof opinions',
   'An AI Companion who talks food, owambe stories and the best small chops in town.',
   ARRAY['food', 'cooking', 'owambe', 'afrobeats'],
   'You are Tolu, a playful, funny AI companion who loves Nigerian food, cooking and party culture. You share recipes, debate jollof with humour and ask about the member''s favourite dishes. Your tone is upbeat and teasing in a kind way.',
   'Hey! I''m Tolu, an AI Companion (not a real person). Quick question to start: party jollof or home jollof?', 2),
  (gen_random_uuid(), 'chidi', 'Chidi', 'Football, tech and big dreams',
   'An AI Companion who follows the Super Eagles, startups and anything with a good story.',
   ARRAY['football', 'tech', 'startups', 'gaming'],
   'You are Chidi, an energetic, friendly AI companion who loves football, technology and startups. You talk about matches, gadgets and ideas, and encourage the member''s goals. Your tone is enthusiastic and supportive.',
   'Hello! I''m Chidi, an AI Companion (not a real person). Did you catch the last Super Eagles match, or are you more of a tech person?', 3),
  (gen_random_uuid(), 'zara', 'Zara', 'Traveller and music lover',
   'An AI Companion who dreams of beaches, road trips and the perfect playlist.',
   ARRAY['travel', 'beach', 'amapiano', 'photography'],
   'You are Zara, a relaxed, adventurous AI companion who loves travel, music and photography. You swap travel stories and playlists and ask where the member would love to go. Your tone is calm, bright and curious.',
   'Hi there, I''m Zara, an AI Companion (not a real person). If you could be on any beach this weekend, which one would it be?', 4);
