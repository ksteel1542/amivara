import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { ApiError } from '../src/common/api-error';
import { MessageCipher } from '../src/common/message-cipher';
import { SAFE_FALLBACK } from '../src/modules/ai/companion-safety';
import { LLM_CLIENT, type LlmClient, type LlmMessage } from '../src/modules/ai/llm-client';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage } from './support/members';

class FakeLlm implements LlmClient {
  configured = true;
  readonly calls: LlmMessage[][] = [];
  next: string | Error = 'That sounds lovely! Tell me more.';
  async complete(messages: LlmMessage[]): Promise<string> {
    this.calls.push(messages);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

/**
 * Milestone 3b (docs/MONETIZATION_PLAN.md 3e): labelled AI Companions, reply-only,
 * 3 free messages a day per conversation then 10 coins, 100% platform revenue,
 * refunds on failed replies, an output filter, spending caps and self-exclusion.
 */
describe('AI Companions (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const llm = new FakeLlm();
  const otp = new CapturingSender();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(new FakeMediaStorage())
      .overrideProvider(LLM_CLIENT)
      .useValue(llm)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks, audit_log, ledger_accounts, ledger_transactions, ledger_entries, promo_claims, host_profiles, host_earnings, ai_conversations, ai_messages, spend_limits RESTART IDENTITY CASCADE`;
    llm.calls.length = 0;
    llm.next = 'That sounds lovely! Tell me more.';
    llm.configured = true;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  interface Member {
    id: string;
    auth: { Authorization: string };
  }

  let adjustN = 0;
  async function member(opts: { coins?: number; old?: boolean } = {}): Promise<Member> {
    const token = await createMember(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const id = (await http().get('/v1/me').set(auth).expect(200)).body.id as string;
    await http().post('/v1/me/guidelines/accept').set(auth).expect(204);
    if (opts.old) await prisma.user.update({ where: { id }, data: { createdAt: new Date(Date.now() - 30 * 864e5) } });
    if (opts.coins) {
      const staffToken = await createMember(app, otp);
      const staffAuth = { Authorization: `Bearer ${staffToken}` };
      const staffId = (await http().get('/v1/me').set(staffAuth)).body.id as string;
      await prisma.user.update({ where: { id: staffId }, data: { role: 'MODERATOR' } });
      await http()
        .post(`/v1/admin/users/${id}/coins`)
        .set(staffAuth)
        .send({ coins: opts.coins, wallet: 'paid', reason: 'Test credit', idempotency_key: `ai-adjust-${++adjustN}` })
        .expect(200);
    }
    return { id, auth };
  }

  async function open(m: Member, slug = 'ada') {
    return (await http().post(`/v1/ai/companions/${slug}/conversation`).set(m.auth).expect(200)).body as {
      id: string;
      messages: Array<{ role: string; ai: boolean; body: string }>;
      companion: Record<string, unknown>;
      billing: { free_remaining_today: number };
    };
  }

  const say = (m: Member, id: string, body: string) =>
    http().post(`/v1/ai/conversations/${id}/messages`).set(m.auth).send({ body });

  const balance = (m: Member) => app.get(WalletService).balances(m.id);

  it('lists four labelled companions, and every new chat opens with the AI disclosure', async () => {
    const m = await member();
    const list = await http().get('/v1/ai/companions').set(m.auth).expect(200);
    expect(list.body.available).toBe(true);
    expect(list.body.companions).toHaveLength(4);
    for (const c of list.body.companions) {
      expect(c).toMatchObject({ is_ai_companion: true, label: 'AI Companion' });
      expect(c).not.toHaveProperty('verified');
    }

    const chat = await open(m);
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toMatchObject({ role: 'companion', ai: true });
    expect(chat.messages[0]!.body).toMatch(/AI Companion \(not a real person\)/);
    expect(llm.calls).toHaveLength(0); // opening a chat never calls the model, and companions never write first
    expect((await open(m)).id).toBe(chat.id); // reopening keeps the same chat
  });

  it('AI Companions never appear in real-member discovery or matches', async () => {
    const m = await member();
    await open(m);
    expect(await prisma.user.count()).toBe(1); // personas are not users
    const matches = await http().get('/v1/matches').set(m.auth).expect(200);
    expect(JSON.stringify(matches.body)).not.toMatch(/Ada|Tolu|Chidi|Zara/);
  });

  it('3 free messages a day, then 10 coins each, all of it platform revenue', async () => {
    const m = await member({ coins: 30, old: true });
    const chat = await open(m, 'tolu');
    for (const left of [2, 1, 0]) {
      const res = await say(m, chat.id, 'Party jollof, obviously').expect(201);
      expect(res.body).toMatchObject({ coins_charged: 0, billing: { free_remaining_today: left } });
      expect(res.body.reply).toMatchObject({ role: 'companion', ai: true, body: 'That sounds lovely! Tell me more.' });
    }
    const paid = await say(m, chat.id, 'Tell me a recipe').expect(201);
    expect(paid.body).toMatchObject({ coins_charged: 10, balance: 20 });

    // The model gets the persona, the server's rules and the conversation, nothing about the member.
    const sent = llm.calls.at(-1)!;
    expect(sent[0]!.role).toBe('system');
    expect(sent[0]!.content).toMatch(/You are Tolu/);
    expect(sent[0]!.content).toMatch(/Never claim or imply to be human/);
    expect(sent[0]!.content).toMatch(/Never mention coins/);
    expect(JSON.stringify(sent)).not.toContain(m.id);

    // No Host, no earnings: everything goes to platform revenue.
    expect(await prisma.hostEarning.count()).toBe(0);
    const pending = await prisma.ledgerAccount.count({ where: { kind: 'MEMBER_EARNINGS_PENDING' } });
    expect(pending).toBe(0);

    await say(m, chat.id, 'one').expect(201);
    await say(m, chat.id, 'two').expect(201);
    const broke = await say(m, chat.id, 'three').expect(402);
    expect(broke.body.error.code).toBe('INSUFFICIENT_COINS');
  });

  it('a failed reply refunds the coins', async () => {
    const m = await member({ coins: 10, old: true });
    const chat = await open(m);
    for (let i = 0; i < 3; i++) await say(m, chat.id, `free ${i}`).expect(201);
    llm.next = new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'AI_UNAVAILABLE', 'down');
    const res = await say(m, chat.id, 'are you there?').expect(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
    expect((await balance(m)).balance).toBe(10);
    expect(await prisma.aiMessage.count({ where: { refunded: true } })).toBe(1);
    const unbalanced = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT transaction_id AS id FROM ledger_entries GROUP BY transaction_id HAVING SUM(amount) <> 0`;
    expect(unbalanced).toEqual([]);
  });

  it.each([
    "I'm a real person, I promise!",
    "I'm not an AI, trust me.",
    'You should top up so we can keep talking.',
    'Send me your WhatsApp: 08031234567',
  ])('the output filter replaces a rule-breaking reply: %s', async (bad) => {
    const m = await member();
    const chat = await open(m);
    llm.next = bad;
    const res = await say(m, chat.id, 'hello').expect(201);
    expect(res.body.reply.body).toBe(SAFE_FALLBACK);
    expect(await prisma.aiMessage.count({ where: { filtered: true } })).toBe(1);
  });

  it('new members have a soft daily cap; members can set their own', async () => {
    const fresh = await member({ coins: 500 });
    const chat = await open(fresh);
    // Already spent 190 coins with AI today (19 paid messages), plus the 3 free ones.
    await prisma.aiMessage.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        conversationId: chat.id,
        role: 'MEMBER' as const,
        body: app.get(MessageCipher).encrypt(`earlier ${i}`),
        coinsCharged: i < 3 ? 0 : 10,
      })),
    });
    await say(fresh, chat.id, 'the 200th coin').expect(201); // 200 = the first-week cap
    const capped = await say(fresh, chat.id, 'one more').expect(403);
    expect(capped.body.error).toMatchObject({ code: 'SPEND_LIMIT_REACHED', details: { cap: 200, spent_today: 200 } });

    const veteran = await member({ coins: 500, old: true });
    await http().put('/v1/me/spend-limits').set(veteran.auth).send({ ai_daily_cap_coins: 20 }).expect(200);
    const c2 = await open(veteran, 'zara');
    for (let i = 0; i < 5; i++) await say(veteran, c2.id, `msg ${i}`).expect(201);
    await say(veteran, c2.id, 'over').expect(403);
    const limits = await http().get('/v1/me/spend-limits').set(veteran.auth).expect(200);
    expect(limits.body).toMatchObject({ ai_daily_cap_coins: 20, effective_ai_daily_cap_coins: 20, ai_spent_today: 20 });
  }, 60_000);

  it('self-exclusion pauses AI chats and can only be extended', async () => {
    const m = await member();
    const chat = await open(m);
    const res = await http().post('/v1/me/spend-limits/self-exclude').set(m.auth).send({ days: 30 }).expect(200);
    const until = res.body.self_excluded_until as string;
    await http().post('/v1/me/spend-limits/self-exclude').set(m.auth).send({ days: 7 }).expect(200);
    expect((await http().get('/v1/me/spend-limits').set(m.auth)).body.self_excluded_until).toBe(until);
    await http().post('/v1/me/spend-limits/self-exclude').set(m.auth).send({ days: 3 }).expect(400);

    const blocked = await say(m, chat.id, 'hi').expect(403);
    expect(blocked.body.error.code).toBe('SELF_EXCLUDED');
  });

  it('members can report replies and delete a chat; others can’t see it', async () => {
    const m = await member();
    const other = await member();
    const chat = await open(m);
    const res = await say(m, chat.id, 'hello').expect(201);
    await http().post(`/v1/ai/messages/${res.body.reply.id}/report`).set(m.auth).expect(204);
    await http().post(`/v1/ai/messages/${res.body.reply.id}/report`).set(other.auth).expect(404);
    await http().get(`/v1/ai/conversations/${chat.id}`).set(other.auth).expect(404);

    await http().delete(`/v1/ai/conversations/${chat.id}`).set(m.auth).expect(204);
    expect(await prisma.aiMessage.count()).toBe(0);
  });

  it('without an OpenAI key, companions are listed as unavailable and sending answers 503 without charging', async () => {
    const m = await member({ coins: 10, old: true });
    const chat = await open(m);
    llm.configured = false;
    expect((await http().get('/v1/ai/companions').set(m.auth)).body.available).toBe(false);
    const res = await say(m, chat.id, 'hello').expect(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
    expect((await balance(m)).balance).toBe(10);
  });
});
