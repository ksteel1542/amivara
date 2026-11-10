-- CreateTable
CREATE TABLE "likes" (
    "liker_id" UUID NOT NULL,
    "likee_id" UUID NOT NULL,
    "is_super" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "likes_pkey" PRIMARY KEY ("liker_id","likee_id")
);

-- CreateTable
CREATE TABLE "passes" (
    "passer_id" UUID NOT NULL,
    "passee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "passes_pkey" PRIMARY KEY ("passer_id","passee_id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateIndex
CREATE INDEX "likes_likee_id_created_at_idx" ON "likes"("likee_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "likes_liker_id_created_at_idx" ON "likes"("liker_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "blocks_blocked_id_idx" ON "blocks"("blocked_id");

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_liker_id_fkey" FOREIGN KEY ("liker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_likee_id_fkey" FOREIGN KEY ("likee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passes" ADD CONSTRAINT "passes_passer_id_fkey" FOREIGN KEY ("passer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passes" ADD CONSTRAINT "passes_passee_id_fkey" FOREIGN KEY ("passee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written constraints (kept in sync with schema.prisma, bottom).
-- ─────────────────────────────────────────────────────────────────────────

-- Nobody can like, pass or block themselves.
ALTER TABLE "likes"  ADD CONSTRAINT "likes_not_self_chk"  CHECK ("liker_id" <> "likee_id");
ALTER TABLE "passes" ADD CONSTRAINT "passes_not_self_chk" CHECK ("passer_id" <> "passee_id");
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_not_self_chk" CHECK ("blocker_id" <> "blocked_id");
