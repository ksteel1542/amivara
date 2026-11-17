import { Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env';
import { AuthModule } from '../auth/auth.module';
import { HostsModule } from '../hosts/hosts.module';
import { MediaModule } from '../media/media.module';
import { MessagingModule } from '../messaging/messaging.module';
import { WalletModule } from '../wallet/wallet.module';
import { CALL_MEDIA, LiveKitMediaProvider } from './call-media';
import { CallsController, CallsWebhookController, MatchCallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { HostConnectController, HostConnectService } from './host-connect';

/** Every CALL_TICK_MS: misses unanswered rings and charges due call minutes. Safe on several instances. */
@Injectable()
export class CallTicker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CallTicker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly calls: CallsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const ms = this.config.get('CALL_TICK_MS', { infer: true });
    if (ms <= 0) return;
    this.timer = setInterval(() => void this.tick(), ms);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.calls.tick();
    } catch (error) {
      this.logger.error(`Call tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

/**
 * 1-on-1 voice and video calls (MONETIZATION_PLAN.md M4/M5): ringing over
 * /ws/chat, LiveKit for media (CALLS_PROVIDER), per-minute billing for calls
 * to Verified Hosts.
 */
@Module({
  imports: [AuthModule, WalletModule, HostsModule, MessagingModule, MediaModule],
  controllers: [MatchCallsController, CallsController, CallsWebhookController, HostConnectController],
  providers: [
    LiveKitMediaProvider,
    { provide: CALL_MEDIA, useExisting: LiveKitMediaProvider },
    CallsService,
    HostConnectService,
    CallTicker,
  ],
  exports: [CallsService, CALL_MEDIA],
})
export class CallsModule {}
