import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env';
import { PaymentsService } from './payments.service';

/**
 * Every PAYMENT_RECONCILE_SECONDS, re-checks unfinished top-ups with the provider,
 * so a lost webhook never leaves a member without the coins they paid for.
 * Each result is applied once (row lock + ledger idempotency key), so running it
 * on several API instances is safe. Moves to a BullMQ repeatable job with the worker.
 */
@Injectable()
export class PaymentsReconciler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentsReconciler.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly payments: PaymentsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.config.get('PAYMENT_RECONCILE_SECONDS', { infer: true });
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
      const result = await this.payments.reconcile();
      if (result.checked) this.logger.log(`Reconcile: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(`Payment reconcile failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
