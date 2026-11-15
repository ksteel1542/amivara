import { Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { HostController, IcebreakersController } from './hosts.controller';
import { HostsService } from './hosts.service';
import { MessageBilling } from './message-billing';

/** Every HOST_RELEASE_SECONDS, releases Host earnings past their hold. Safe on several instances. */
@Injectable()
export class EarningsReleaser implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EarningsReleaser.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly hosts: HostsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.config.get('HOST_RELEASE_SECONDS', { infer: true });
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
      await this.hosts.releaseDue();
    } catch (error) {
      this.logger.error(`Earnings release failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

/**
 * Verified Hosts (MONETIZATION_PLAN.md M3): opt-in, paid messages to Hosts,
 * held earnings and their release, and Host icebreakers.
 */
@Module({
  imports: [AuthModule, WalletModule],
  controllers: [HostController, IcebreakersController],
  providers: [HostsService, MessageBilling, EarningsReleaser],
  exports: [HostsService, MessageBilling],
})
export class HostsModule {}
