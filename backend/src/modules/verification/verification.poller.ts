import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env';
import { VerificationService } from './verification.service';

/**
 * Status fallback for delayed or lost Smile ID callbacks (ARCHITECTURE.md §5):
 * every VERIFICATION_POLL_SECONDS it asks Smile ID about sessions that have
 * been pending for more than 2 minutes. Each result is applied at most once
 * (conditional update), so running it on several API instances is safe.
 * Moves to a BullMQ repeatable job when the worker service exists.
 */
@Injectable()
export class VerificationPoller implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(VerificationPoller.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly verification: VerificationService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.config.get('VERIFICATION_POLL_SECONDS', { infer: true });
    if (seconds <= 0) return; // disabled (tests, or local dev)
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.verification.pollPending();
      if (result.resolved || result.expired) this.logger.log(`Poll: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(`Verification poll failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
