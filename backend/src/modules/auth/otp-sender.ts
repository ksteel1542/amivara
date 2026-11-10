import { Injectable, Logger } from '@nestjs/common';

import { maskPhone } from './phone';

export type OtpChannelName = 'sms' | 'whatsapp';

/** Delivers a one-time code. Implemented per provider (SMS/WhatsApp aggregator, chosen later). */
export interface OtpSender {
  send(phoneE164: string, code: string, channel: OtpChannelName): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

/**
 * Development/test sender: logs the code instead of sending it.
 * env.ts refuses this sender in production. In staging it is allowed so the
 * team can test end to end before the provider contract is signed: never use
 * real member numbers there.
 */
@Injectable()
export class ConsoleOtpSender implements OtpSender {
  private readonly logger = new Logger('ConsoleOtpSender');

  async send(phoneE164: string, code: string, channel: OtpChannelName): Promise<void> {
    this.logger.warn(`[${channel}] OTP for ${maskPhone(phoneE164)}: ${code} (console sender, not delivered)`);
  }
}
