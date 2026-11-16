import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from 'livekit-server-sdk';

import type { Env } from '../../config/env';

export interface JoinGrant {
  /** The server URL the app connects to. */
  url: string;
  /** A short-lived token for one member in one call room. */
  token: string;
}

/** What the media server told us happened in a room (webhooks). */
export interface MediaEvent {
  kind: 'participant_left' | 'room_finished' | 'other';
  room: string;
  identity?: string;
}

/**
 * The media server behind 1-on-1 calls. Swappable: LiveKit today (CALLS_PROVIDER).
 * The API owns call state and billing; the media server only carries audio/video,
 * so a provider never decides who may call whom or what it costs.
 */
export interface CallMediaProvider {
  readonly configured: boolean;
  /** Creates the room for an answered call: two participants at most, gone soon after it empties. */
  openRoom(room: string): Promise<void>;
  /** A join token: microphone only for voice calls, microphone and camera for video. */
  joinToken(input: { room: string; identity: string; video: boolean }): Promise<JoinGrant>;
  /** Disconnects everyone (the call ended, or ran out of coins). Never throws. */
  closeRoom(room: string): Promise<void>;
  /** Verifies and parses a signed webhook. Throws when the signature is wrong. */
  parseWebhook(rawBody: string, authorization: string | undefined): Promise<MediaEvent>;
}

export const CALL_MEDIA = Symbol('CALL_MEDIA');

/** Join tokens only need to outlive the time it takes to connect. */
const TOKEN_TTL_SECONDS = 10 * 60;
const MAX_CALL_PARTICIPANTS = 2;
/** Seconds an empty room lingers (a reconnecting phone can rejoin). */
const EMPTY_TIMEOUT_SECONDS = 60;

@Injectable()
export class LiveKitMediaProvider implements CallMediaProvider {
  private readonly logger = new Logger(LiveKitMediaProvider.name);
  private readonly url?: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private rooms?: RoomServiceClient;

  constructor(config: ConfigService<Env, true>) {
    this.url = config.get('LIVEKIT_URL', { infer: true });
    this.apiKey = config.get('LIVEKIT_API_KEY', { infer: true });
    this.apiSecret = config.get('LIVEKIT_API_SECRET', { infer: true });
  }

  get configured(): boolean {
    return Boolean(this.url && this.apiKey && this.apiSecret);
  }

  private roomService(): RoomServiceClient {
    // RoomService speaks HTTPS to the same host the app reaches over wss.
    this.rooms ??= new RoomServiceClient(this.url!.replace(/^ws/, 'http'), this.apiKey, this.apiSecret);
    return this.rooms;
  }

  async openRoom(room: string): Promise<void> {
    await this.roomService().createRoom({
      name: room,
      maxParticipants: MAX_CALL_PARTICIPANTS,
      emptyTimeout: EMPTY_TIMEOUT_SECONDS,
      departureTimeout: EMPTY_TIMEOUT_SECONDS,
    });
  }

  async joinToken(input: { room: string; identity: string; video: boolean }): Promise<JoinGrant> {
    const at = new AccessToken(this.apiKey, this.apiSecret, { identity: input.identity, ttl: TOKEN_TTL_SECONDS });
    at.addGrant({
      roomJoin: true,
      room: input.room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      canPublishSources: input.video ? [TrackSource.MICROPHONE, TrackSource.CAMERA] : [TrackSource.MICROPHONE],
    });
    return { url: this.url!, token: await at.toJwt() };
  }

  async closeRoom(room: string): Promise<void> {
    if (!this.configured) return;
    try {
      await this.roomService().deleteRoom(room);
    } catch (error) {
      // Already gone (both hung up) is the usual case; the empty timeout cleans up the rest.
      this.logger.debug(`deleteRoom ${room}: ${(error as Error).message}`);
    }
  }

  async parseWebhook(rawBody: string, authorization: string | undefined): Promise<MediaEvent> {
    if (!this.configured) throw new Error('LiveKit is not configured');
    const event = await new WebhookReceiver(this.apiKey!, this.apiSecret!).receive(rawBody, authorization);
    const kind = event.event === 'participant_left' || event.event === 'room_finished' ? event.event : 'other';
    return { kind, room: event.room?.name ?? '', identity: event.participant?.identity };
  }
}
