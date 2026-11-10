import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env';
import { AccountService } from './account.service';

/**
 * Hard-deletes accounts 30 days after their owners deleted them, every
 * ACCOUNT_PURGE_SECONDS (0 disables it: tests and local dev). Each purge is
 * conditional, so running it on several API instances is safe. Moves to a
 * BullMQ repeatable job when the worker service exists.
 */
@Injectable()
export class AccountPurger implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AccountPurger.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly account: AccountService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.config.get('ACCOUNT_PURGE_SECONDS', { infer: true });
    if (seconds <= 0) return;
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
      await this.account.purgeDue();
    } catch (error) {
      this.logger.error(`Account purge failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
