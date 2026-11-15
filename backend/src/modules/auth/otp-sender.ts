import { Injectable, Logger } from '@nestjs/common';

import { maskEmail } from './identity';
import { maskPhone } from './phone';

export type OtpChannelName = 'sms' | 'whatsapp' | 'email';

/**
 * Delivers a one-time code to a phone (SMS/WhatsApp) or an email address.
 * Implemented per provider: an email service (e.g. Amazon SES) and an SMS aggregator, chosen later.
 */
export interface OtpSender {
  send(destination: string, code: string, channel: OtpChannelName): Promise<void>;
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

  async send(destination: string, code: string, channel: OtpChannelName): Promise<void> {
    const to = channel === 'email' ? maskEmail(destination) : maskPhone(destination);
    this.logger.warn(`[${channel}] OTP for ${to}: ${code} (console sender, not delivered)`);
  }
}
