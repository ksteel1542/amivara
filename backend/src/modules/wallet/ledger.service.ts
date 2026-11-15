import { HttpStatus, Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma';
import { ApiError } from '../../common/api-error';
import { PrismaService } from '../../prisma/prisma.service';

export type AccountKind = Prisma.LedgerAccountCreateInput['kind'];
export type TransactionKind = Prisma.LedgerTransactionCreateInput['kind'];
type Tx = Prisma.TransactionClient;

export interface Posting {
  /** null = the platform account of that kind */
  ownerId: string | null;
  kind: AccountKind;
  amount: number;
}

export interface PostInput {
  kind: TransactionKind;
  idempotencyKey: string;
  userId?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
  postings: Posting[];
}

/**
 * Double-entry coin ledger (docs/MONETIZATION_PLAN.md). The database enforces
 * the invariants (balanced per transaction, no member overdraft, append-only);
 * this service only builds correct transactions and makes them idempotent.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Posts a balanced transaction once. Replaying the same idempotency key
   * returns the original transaction instead of posting again.
   */
  async post(input: PostInput, tx?: Tx): Promise<{ id: string; replayed: boolean }> {
    if (input.postings.reduce((sum, p) => sum + p.amount, 0) !== 0) {
      throw new Error('Unbalanced ledger transaction');
    }
    if (input.postings.some((p) => !Number.isInteger(p.amount) || p.amount === 0)) {
      throw new Error('Ledger amounts must be non-zero whole numbers');
    }
    const run = async (t: Tx) => {
      const created = await t.ledgerTransaction.create({
        data: {
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
          userId: input.userId,
          actorId: input.actorId,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
      for (const p of input.postings) {
        const accountId = await this.accountId(t, p.ownerId, p.kind);
        await t.ledgerEntry.create({ data: { transactionId: created.id, accountId, amount: BigInt(p.amount) } });
      }
      return created.id;
    };
    try {
      const id = tx ? await run(tx) : await this.prisma.$transaction(run);
      return { id, replayed: false };
    } catch (error) {
      if (isOverdraft(error)) {
        throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'INSUFFICIENT_COINS', "You don't have enough coins.");
      }
      // Inside a caller's transaction, Postgres has already aborted it: let the caller decide.
      if (tx) throw error;
      if (isUniqueViolation(error, 'idempotency_key')) {
        const existing = await this.prisma.ledgerTransaction.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
        return { id: existing.id, replayed: true };
      }
      if (isOverdraft(error)) {
        throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'INSUFFICIENT_COINS', "You don't have enough coins.");
      }
      throw error;
    }
  }

  /** Current balance of one account (0 if it doesn't exist yet). */
  async balance(ownerId: string | null, kind: AccountKind, tx: Tx | PrismaService = this.prisma): Promise<number> {
    const account = await tx.ledgerAccount.findFirst({ where: { ownerId, kind }, select: { balance: true } });
    return Number(account?.balance ?? 0n);
  }

  /** Get-or-create. Platform accounts exist once per kind (partial unique index). */
  async accountId(tx: Tx, ownerId: string | null, kind: AccountKind): Promise<string> {
    const found = await tx.ledgerAccount.findFirst({ where: { ownerId, kind }, select: { id: true } });
    if (found) return found.id;
    // Race-safe create: a concurrent creator wins, we re-read.
    await tx.$executeRaw`
      INSERT INTO ledger_accounts (id, owner_id, kind, currency)
      VALUES (gen_random_uuid(), ${ownerId}::uuid, ${kind}::ledger_account_kind, 'COIN')
      ON CONFLICT DO NOTHING`;
    const created = await tx.ledgerAccount.findFirstOrThrow({ where: { ownerId, kind }, select: { id: true } });
    return created.id;
  }
}

function isUniqueViolation(error: unknown, field: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    JSON.stringify(error.meta ?? {}).includes(field)
  );
}

function isOverdraft(error: unknown): boolean {
  return error instanceof Error && error.message.includes('ledger_accounts_member_nonnegative_chk');
}
