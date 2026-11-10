import { createSign } from 'node:crypto';

import { Logger } from '@nestjs/common';

/**
 * A push message. Privacy rules (PRD §5.6, SECURITY.md §5):
 * - visible notifications are generic: no names, photos or anything that
 *   reveals who, on a lock screen anyone might see
 * - never any location
 * - `data` carries only opaque ids for the app to fetch details after unlock
 */
export interface PushMessage {
  /** Omitted for silent, data-only messages (e.g. an unmatch just refreshes the list). */
  notification?: { title: string; body: string };
  data: Record<string, string>;
}

export type SendResult = 'sent' | 'unregistered' | 'failed';

export interface PushSender {
  readonly enabled: boolean;
  send(token: string, message: PushMessage): Promise<SendResult>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** Used when FCM is not configured (local dev): logs instead of sending. */
export class DisabledPushSender implements PushSender {
  private readonly logger = new Logger('DisabledPushSender');
  readonly enabled = false;

  async send(_token: string, message: PushMessage): Promise<SendResult> {
    this.logger.debug(`Push disabled; would send ${message.data.type ?? 'message'}`);
    return 'sent';
  }
}

export interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  privateKeyPem: string;
}

/**
 * Firebase Cloud Messaging HTTP v1, without the firebase-admin SDK.
 * Authenticates with a Google service account: an RS256 JWT assertion
 * (signed with node:crypto) is exchanged for an OAuth access token, which is
 * cached until shortly before it expires.
 * (Built by NotificationsModule's factory, not by dependency injection.)
 */
export class FcmPushSender implements PushSender {
  private readonly logger = new Logger(FcmPushSender.name);
  readonly enabled = true;
  private accessToken: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly creds: FcmCredentials,
    private readonly http: typeof fetch = fetch,
  ) {}

  async send(token: string, message: PushMessage): Promise<SendResult> {
    const response = await this.http(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.creds.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${await this.oauthToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            data: message.data,
            ...(message.notification ? { notification: message.notification } : {}),
            android: {
              priority: message.notification ? 'high' : 'normal',
              // Lock screens show the generic text only; never the content.
              ...(message.notification ? { notification: { visibility: 'PRIVATE', channel_id: 'matches' } } : {}),
            },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.ok) return 'sent';

    const body = await response.text();
    // The token is dead (app uninstalled, data cleared): stop sending to it.
    if (
      response.status === 404 ||
      body.includes('UNREGISTERED') ||
      body.includes('registration-token-not-registered')
    ) {
      return 'unregistered';
    }
    this.logger.warn(`FCM send failed: HTTP ${response.status}`);
    return 'failed';
  }

  private async oauthToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt - 60_000 > now) return this.accessToken.value;

    const iat = Math.floor(now / 1000);
    const encode = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: this.creds.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.creds.privateKeyPem).toString('base64url');

    const response = await this.http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Google OAuth token request failed: HTTP ${response.status}`);
    const json = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: json.access_token, expiresAt: now + json.expires_in * 1000 };
    return json.access_token;
  }
}
