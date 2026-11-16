import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import type { Env } from '../../config/env';
import { AuthModule } from '../auth/auth.module';
import { CurrentMember } from '../auth/auth.guards';
import { HostsModule } from '../hosts/hosts.module';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { RequireActiveMember } from '../verification/active-member.guard';
import { WalletModule } from '../wallet/wallet.module';
import { PAYOUT_PROVIDER, PaystackPayouts } from './payout-provider';
import { PayoutsService } from './payouts.service';

const accountSchema = z
  .object({
    bank_code: z.string().min(1).max(20),
    account_number: z.string().regex(/^\d{10}$/, 'Account numbers are 10 digits'),
  })
  .strict();
const withdrawSchema = z.object({ coins: z.number().int().positive().optional() }).strict();

/** API.md "Host payouts". */
@Controller('hosts')
@RequireActiveMember()
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get('banks')
  banks() {
    return this.payouts.banks();
  }

  @Get('bank-account')
  account(@CurrentMember() m: AuthenticatedMember) {
    return this.payouts.account(m.id);
  }

  /** Looks the account up (the holder's name) without saving it. */
  @Post('bank-account/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(
    @CurrentMember() m: AuthenticatedMember,
    @Body(new ZodValidationPipe(accountSchema)) body: z.infer<typeof accountSchema>,
  ) {
    return this.payouts.resolve(m.id, body.bank_code, body.account_number);
  }

  @Post('bank-account')
  @HttpCode(HttpStatus.OK)
  save(
    @CurrentMember() m: AuthenticatedMember,
    @Body(new ZodValidationPipe(accountSchema)) body: z.infer<typeof accountSchema>,
  ) {
    return this.payouts.saveAccount(m.id, body.bank_code, body.account_number);
  }

  @Get('payouts')
  summary(@CurrentMember() m: AuthenticatedMember) {
    return this.payouts.summary(m.id);
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.CREATED)
  withdraw(
    @CurrentMember() m: AuthenticatedMember,
    @Body(new ZodValidationPipe(withdrawSchema)) body: z.infer<typeof withdrawSchema>,
  ) {
    return this.payouts.withdraw(m.id, body.coins);
  }
}

/** Every PAYOUT_RECONCILE_SECONDS: re-checks payouts still pending with Paystack. Hooks up transfer webhooks. */
@Injectable()
export class PayoutsReconciler implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PayoutsReconciler.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly payouts: PayoutsService,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.payments.onTransferEvent((reference) => this.payouts.onTransferEvent(reference));
  }

  onApplicationBootstrap(): void {
    const seconds = this.config.get('PAYOUT_RECONCILE_SECONDS', { infer: true });
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
      await this.payouts.reconcile();
    } catch (error) {
      this.logger.error(`Payout reconcile failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

/** Host payouts to Nigerian bank accounts via Paystack Transfers (MONETIZATION_PLAN.md M7/M8). */
@Module({
  imports: [AuthModule, WalletModule, HostsModule, PaymentsModule],
  controllers: [PayoutsController],
  providers: [
    PaystackPayouts,
    { provide: PAYOUT_PROVIDER, useExisting: PaystackPayouts },
    PayoutsService,
    PayoutsReconciler,
  ],
  exports: [PayoutsService],
})
export class PayoutsModule {}
