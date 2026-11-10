import { Injectable } from '@nestjs/common';

import { HasherService } from '../../common/hasher.service';
import { PrismaService } from '../../prisma/prisma.service';

/** SECURITY.md §1: an under-18 attempt blocks that phone and device for 12 months. */
export const UNDERAGE_BLOCK_DAYS = 365;

@Injectable()
export class SignupBlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: HasherService,
  ) {}

  /** HMAC subjects for a phone and (optionally) an already-hashed device id. */
  subjects(phoneE164: string, deviceHash?: string): string[] {
    const subjects = [this.hasher.hash('phone', phoneE164)];
    if (deviceHash) subjects.push(this.hasher.hash('device', `blocked:${deviceHash}`));
    return subjects;
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
