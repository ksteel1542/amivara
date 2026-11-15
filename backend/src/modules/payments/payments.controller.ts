import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { ApiError } from '../../common/api-error';
import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember, Public } from '../auth/auth.guards';
import { RequireActiveMember } from '../verification/active-member.guard';
import { PaymentsService, REFERENCE_PREFIX } from './payments.service';
import { PaystackClient } from './paystack.client';

const topupSchema = z
  .object({ package_id: z.string().uuid(), provider: z.enum(['paystack', 'google_play']).default('paystack') })
  .strict();

/** API.md "Wallet": coin top-ups. */
@Controller('wallet/topups')
@RequireActiveMember()
export class TopupsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Starts a checkout: returns the payment intent and the URL the member pays on. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(topupSchema)) body: z.infer<typeof topupSchema>,
  ) {
    return this.payments.createTopup(member.id, { packageId: body.package_id, provider: body.provider });
  }

  /** Status of one top-up; re-checks a pending one with the provider. */
  @Get(':id')
  get(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.payments.getTopup(member.id, id);
  }
}

/** Provider callbacks. Public, but authenticated by signature. */
@Controller('payments')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly paystack: PaystackClient,
  ) {}

  /**
   * Paystack webhook. The signature (x-paystack-signature, HMAC-SHA512 of the raw
   * body) must match, and the body is only a prompt: the payment is confirmed with
   * Paystack's verify-transaction API before any coins are credited. Answers 200
   * for every authentic event, so Paystack doesn't retry ones we've handled.
   */
  @Public()
  @Post('paystack/webhook')
  @HttpCode(HttpStatus.OK)
  async paystackWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-paystack-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!this.paystack.verifySignature(req.rawBody, signature)) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Invalid signature.');
    }
    const body = req.body as { event?: unknown; data?: { reference?: unknown } } | undefined;
    const reference = typeof body?.data?.reference === 'string' ? body.data.reference : null;
    if (
      (body?.event === 'charge.success' || body?.event === 'charge.failed') &&
      reference?.startsWith(REFERENCE_PREFIX) &&
      reference.length <= 100
    ) {
      // Let a provider outage surface as 5xx, so Paystack retries later.
      const intent = await this.payments.confirm(reference);
      if (!intent) this.logger.warn('Paystack webhook for an unknown reference');
    }
    return { received: true };
  }

  /**
   * Where Paystack sends the member after paying (PAYSTACK_CALLBACK_URL). The app
   * watches the top-up itself, so this page only says to go back to the app.
   */
  @Public()
  @Get('paystack/return')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  paystackReturn(): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AMIVARA</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 16px;background:#fff8f6;color:#2b1a1d"><h1 style="font-size:22px">Thank you</h1><p>Your payment is being confirmed. You can close this page and go back to AMIVARA.</p></body></html>`;
  }
}
