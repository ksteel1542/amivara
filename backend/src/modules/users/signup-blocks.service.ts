import { Injectable } from '@nestjs/common';

import { HasherService } from '../../common/hasher.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { Identity } from '../auth/identity';

/** SECURITY.md §1: an under-18 attempt blocks that email or phone, and the device, for 12 months. */
export const UNDERAGE_BLOCK_DAYS = 365;

@Injectable()
export class SignupBlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: HasherService,
  ) {}

  /** HMAC subjects for one or more identities (phone or email) and, optionally, an already-hashed device id. */
  subjects(identities: Identity | Identity[], deviceHash?: string): string[] {
    const list = Array.isArray(identities) ? identities : [identities];
    const subjects = list.map((i) => this.hasher.hash(i.kind === 'email' ? 'email' : 'phone', i.value));
    if (deviceHash) subjects.push(this.deviceSubject(deviceHash));
    return subjects;
  }

  /** The subject that blocks a device, whichever account it signed in to. */
  deviceSubject(deviceHash: string): string {
    return this.hasher.hash('device', `blocked:${deviceHash}`);
  }

  async isBlocked(subjects: string[]): Promise<boolean> {
    const hit = await this.prisma.signupBlock.findFirst({
      where: { subject: { in: subjects }, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return hit !== null;
  }

  async blockUnderage(subjects: string[]): Promise<void> {
    const expiresAt = new Date(Date.now() + UNDERAGE_BLOCK_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.signupBlock.createMany({
      data: subjects.map((subject) => ({ subject, reason: 'UNDERAGE' as const, expiresAt })),
    });
  }
}
