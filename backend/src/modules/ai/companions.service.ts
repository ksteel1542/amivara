import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AiMessage, AiPersona } from '../../../generated/prisma';
import { ApiError } from '../../common/api-error';
import { MessageCipher } from '../../common/message-cipher';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { startOfLagosDay } from '../hosts/message-billing';
import { LedgerService } from '../wallet/ledger.service';
import { WalletService } from '../wallet/wallet.service';
import { COMPANION_RULES, SAFE_FALLBACK, violatesRules } from './companion-safety';
import { LLM_CLIENT, type LlmClient, type LlmMessage } from './llm-client';

export const MAX_AI_MESSAGE_LENGTH = 1000;
/** Recent messages sent to the model as context. */
const CONTEXT_MESSAGES = 20;
const AI_MESSAGES_PER_MINUTE = 12;
const NEW_MEMBER_DAYS = 7;
export const SELF_EXCLUSION_DAYS = [7, 30] as const;

/** Every AI surface carries this label (MONETIZATION_PLAN.md 3e). */
export const AI_LABEL = 'AI Companion';

/**
 * AI Companions (MONETIZATION_PLAN.md 3e / M3b): clearly labelled personas that
 * only reply when a member writes to them. Messages cost coins after a daily free
 * allowance, all of it platform revenue (no Host, no earnings). Wellbeing rules:
 * a member-set daily cap, a soft cap in the first week, and self-exclusion.
 */
@Injectable()
export class CompanionsService {
  private readonly logger = new Logger(CompanionsService.name);
  private readonly price: number;
  private readonly freePerDay: number;
  private readonly newMemberCap: number;
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: MessageCipher,
    private readonly wallets: WalletService,
    private readonly ledger: LedgerService,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    config: ConfigService<Env, true>,
  ) {
    this.price = config.get('AI_MESSAGE_PRICE_COINS', { infer: true });
    this.freePerDay = config.get('FREE_AI_MESSAGES_PER_DAY', { infer: true });
    this.newMemberCap = config.get('AI_NEW_MEMBER_DAILY_CAP', { infer: true });
  }

  // ── Personas and conversations ─────────────────────────

  async personas() {
    const rows = await this.prisma.aiPersona.findMany({ where: { active: true }, orderBy: { sort: 'asc' } });
    return { available: this.llm.configured, companions: rows.map((p) => this.personaView(p)) };
  }

  /** The member opens (or reopens) a chat. A new one starts with the persona's fixed AI disclosure. */
  async open(userId: string, slug: string) {
    const persona = await this.prisma.aiPersona.findFirst({ where: { slug, active: true } });
    if (!persona) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'AI Companion not found.');
    const conversation = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.aiConversation.findUnique({
        where: { userId_personaId: { userId, personaId: persona.id } },
      });
      if (existing) return existing;
      const created = await tx.aiConversation.create({
        data: { userId, personaId: persona.id, lastMessageAt: new Date() },
      });
      await tx.aiMessage.create({
        data: { conversationId: created.id, role: 'COMPANION', body: this.cipher.encrypt(persona.greeting) },
      });
      return created;
    });
    return this.conversationView(userId, conversation.id);
  }

  async conversations(userId: string) {
    const rows = await this.prisma.aiConversation.findMany({
      where: { userId },
      orderBy: { lastMessageAt: 'desc' },
      include: { persona: true },
    });
    return {
      conversations: rows.map((c) => ({
        id: c.id,
        companion: this.personaView(c.persona),
        last_message_at: c.lastMessageAt?.toISOString() ?? null,
      })),
    };
  }

  async conversationView(userId: string, id: string) {
    const c = await this.owned(userId, id);
    const messages = await this.prisma.aiMessage.findMany({
      where: { conversationId: c.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      id: c.id,
      companion: this.personaView(c.persona),
      messages: messages.map((m) => this.messageView(m)),
      billing: await this.billing(userId, c.id),
    };
  }

  async remove(userId: string, id: string): Promise<void> {
    const c = await this.owned(userId, id);
    await this.prisma.aiConversation.delete({ where: { id: c.id } });
  }

  async report(userId: string, messageId: string): Promise<void> {
    const m = await this.prisma.aiMessage.findFirst({
      where: { id: messageId, role: 'COMPANION', conversation: { userId } },
    });
    if (!m) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Message not found.');
    await this.prisma.aiMessage.update({ where: { id: m.id }, data: { reportedAt: new Date() } });
    this.logger.warn(`AI Companion message ${m.id} reported for review`);
  }

  // ── Sending ────────────────────────────────────────────

  async send(userId: string, conversationId: string, rawBody: string) {
    const body = rawBody.trim();
    if (!body || body.length > MAX_AI_MESSAGE_LENGTH) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        `Messages must be 1–${MAX_AI_MESSAGE_LENGTH} characters.`,
      );
    }
    const c = await this.owned(userId, conversationId);
    if (!this.llm.configured) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AI_UNAVAILABLE',
        'AI Companions are not available right now.',
      );
    }
    this.rateLimit(userId);
    const limits = await this.prisma.spendLimit.findUnique({ where: { userId } });
    if (limits?.selfExcludedUntil && limits.selfExcludedUntil > new Date()) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'SELF_EXCLUDED',
        'You’ve taken a break from AI Companions. It ends automatically.',
        { until: limits.selfExcludedUntil.toISOString() },
      );
    }

    // 1. Store the member's message and charge for it, together.
    const { message, spend } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai:${userId}`}, 0))`;
      const sentToday = await tx.aiMessage.count({
        where: { conversationId: c.id, role: 'MEMBER', createdAt: { gte: startOfLagosDay(new Date()) } },
      });
      const charge = sentToday >= this.freePerDay ? this.price : 0;
      if (charge > 0) {
        const cap = await this.dailyCap(userId, limits?.aiDailyCapCoins ?? null);
        if (cap !== null) {
          const spent = await this.spentToday(userId, tx);
          if (spent + charge > cap) {
            throw new ApiError(
              HttpStatus.FORBIDDEN,
              'SPEND_LIMIT_REACHED',
              "You've reached today's AI Companion spending limit. It resets at midnight.",
              { cap, spent_today: spent },
            );
          }
        }
      }
      const message = await tx.aiMessage.create({
        data: { conversationId: c.id, role: 'MEMBER', body: this.cipher.encrypt(body), coinsCharged: charge },
      });
      // No earner: AI spend is 100% platform revenue, never Host earnings.
      const spend =
        charge > 0
          ? await this.wallets.spendIn(tx, {
              userId,
              coins: charge,
              idempotencyKey: `ai-message:${message.id}`,
              metadata: { reason: 'ai_message', ai_conversation_id: c.id, persona: c.persona.slug },
            })
          : null;
      return { message, spend };
    });

    // 2. Ask the model, outside the transaction. A failure refunds the coins.
    let reply: string;
    let filtered = false;
    try {
      reply = await this.llm.complete(await this.context(c.id, c.persona));
      if (violatesRules(reply)) {
        this.logger.warn(`AI Companion reply in ${c.id} replaced by the output filter`);
        reply = SAFE_FALLBACK;
        filtered = true;
      }
    } catch (error) {
      if (spend) await this.refund(userId, message.id, spend.promoSpent, spend.paidSpent);
      throw error;
    }

    const saved = await this.prisma.aiMessage.create({
      data: { conversationId: c.id, role: 'COMPANION', body: this.cipher.encrypt(reply.slice(0, 2000)), filtered },
    });
    await this.prisma.aiConversation.update({ where: { id: c.id }, data: { lastMessageAt: saved.createdAt } });
    return {
      message: this.messageView(message),
      reply: this.messageView(saved),
      coins_charged: message.coinsCharged,
      balance: (await this.wallets.balances(userId)).balance,
      billing: await this.billing(userId, c.id),
    };
  }

  private async refund(userId: string, messageId: string, promo: number, paid: number): Promise<void> {
    await this.ledger.post({
      kind: 'REFUND',
      idempotencyKey: `ai-refund:${messageId}`,
      userId,
      metadata: { reason: 'ai_reply_failed', ai_message_id: messageId },
      postings: [
        ...(promo
          ? [
              { ownerId: null, kind: 'PLATFORM_PROMO' as const, amount: -promo },
              { ownerId: userId, kind: 'MEMBER_COINS_PROMO' as const, amount: promo },
            ]
          : []),
        ...(paid
          ? [
              { ownerId: null, kind: 'PLATFORM_REVENUE' as const, amount: -paid },
              { ownerId: userId, kind: 'MEMBER_COINS_PAID' as const, amount: paid },
            ]
          : []),
      ],
    });
    await this.prisma.aiMessage.update({ where: { id: messageId }, data: { refunded: true } });
  }

  /** Persona + server rules + the recent conversation, oldest first. */
  private async context(conversationId: string, persona: AiPersona): Promise<LlmMessage[]> {
    const recent = await this.prisma.aiMessage.findMany({
      where: { conversationId, refunded: false },
      orderBy: { createdAt: 'desc' },
      take: CONTEXT_MESSAGES,
    });
    return [
      {
        role: 'system',
        content: `${persona.personaPrompt}\nYour name is ${persona.displayName}.\n\n${COMPANION_RULES}`,
      },
      ...recent.reverse().map((m): LlmMessage => ({
        role: m.role === 'MEMBER' ? 'user' : 'assistant',
        content: this.cipher.decrypt(m.body),
      })),
    ];
  }

  // ── Spending limits ────────────────────────────────────

  /** The cap that applies today: the member's own, and a soft cap in their first week. Null = none. */
  private async dailyCap(userId: string, personal: number | null): Promise<number | null> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { createdAt: true } });
    const isNew = Date.now() - user.createdAt.getTime() < NEW_MEMBER_DAYS * 24 * 60 * 60 * 1000;
    const caps = [personal, isNew ? this.newMemberCap : null].filter((c): c is number => c !== null);
    return caps.length ? Math.min(...caps) : null;
  }

  private async spentToday(userId: string, tx?: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) {
    const db = tx ?? this.prisma;
    const sum = await db.aiMessage.aggregate({
      where: {
        role: 'MEMBER',
        refunded: false,
        createdAt: { gte: startOfLagosDay(new Date()) },
        conversation: { userId },
      },
      _sum: { coinsCharged: true },
    });
    return sum._sum.coinsCharged ?? 0;
  }

  async limits(userId: string) {
    const row = await this.prisma.spendLimit.findUnique({ where: { userId } });
    const personal = row?.aiDailyCapCoins ?? null;
    const active = row?.selfExcludedUntil && row.selfExcludedUntil > new Date() ? row.selfExcludedUntil : null;
    return {
      ai_daily_cap_coins: personal,
      effective_ai_daily_cap_coins: await this.dailyCap(userId, personal),
      ai_spent_today: await this.spentToday(userId),
      self_excluded_until: active?.toISOString() ?? null,
    };
  }

  async setCap(userId: string, cap: number | null) {
    await this.prisma.spendLimit.upsert({
      where: { userId },
      create: { userId, aiDailyCapCoins: cap },
      update: { aiDailyCapCoins: cap },
    });
    return this.limits(userId);
  }

  /** A break from AI Companions. It can be extended but never shortened. */
  async selfExclude(userId: string, days: number) {
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const row = await this.prisma.spendLimit.findUnique({ where: { userId } });
    if (!row?.selfExcludedUntil || row.selfExcludedUntil < until) {
      await this.prisma.spendLimit.upsert({
        where: { userId },
        create: { userId, selfExcludedUntil: until },
        update: { selfExcludedUntil: until },
      });
    }
    return this.limits(userId);
  }

  // ── Helpers ────────────────────────────────────────────

  private async billing(userId: string, conversationId: string) {
    const sentToday = await this.prisma.aiMessage.count({
      where: { conversationId, role: 'MEMBER', createdAt: { gte: startOfLagosDay(new Date()) } },
    });
    return {
      price_coins: this.price,
      free_per_day: this.freePerDay,
      free_remaining_today: Math.max(0, this.freePerDay - sentToday),
    };
  }

  private async owned(userId: string, id: string) {
    const c = await this.prisma.aiConversation.findFirst({ where: { id, userId }, include: { persona: true } });
    if (!c) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Conversation not found.');
    return c;
  }

  private rateLimit(userId: string): void {
    const now = Date.now();
    const hits = (this.recent.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= AI_MESSAGES_PER_MINUTE) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'MESSAGE_RATE_LIMITED', "You're sending messages too quickly.", {
        retry_after: 60,
      });
    }
    hits.push(now);
    this.recent.set(userId, hits);
    if (this.recent.size > 50_000) this.recent.clear();
  }

  private personaView(p: AiPersona) {
    return {
      id: p.id,
      slug: p.slug,
      name: p.displayName,
      tagline: p.tagline,
      bio: p.bio,
      interests: p.interests,
      is_ai_companion: true as const,
      label: AI_LABEL,
    };
  }

  private messageView(m: AiMessage) {
    return {
      id: m.id,
      role: m.role === 'MEMBER' ? ('member' as const) : ('companion' as const),
      /** Every companion message is marked as AI. */
      ai: m.role === 'COMPANION',
      body: this.cipher.decrypt(m.body),
      coins_charged: m.coinsCharged,
      refunded: m.refunded,
      created_at: m.createdAt.toISOString(),
    };
  }
}
