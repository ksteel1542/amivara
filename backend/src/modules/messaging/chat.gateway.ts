import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';

import { ApiError } from '../../common/api-error';
import { PrismaService } from '../../prisma/prisma.service';
import { TokensService } from '../auth/tokens.service';
import { CLOSE_FORBIDDEN, CLOSE_UNAUTHENTICATED, MessagingService } from './messaging.service';
import { RealtimeRegistry } from './realtime.registry';

export const CHAT_PATH = '/ws/chat';
/** Close codes (API.md "Messaging"): 4401 sign in again, 4403 verification required / not allowed. */
export { CLOSE_FORBIDDEN, CLOSE_UNAUTHENTICATED };
const HEARTBEAT_MS = 30_000;
const MAX_FRAME_BYTES = 16 * 1024;

const clientEvent = z.discriminatedUnion('event', [
  z.object({ event: z.literal('message.send'), data: z.object({ match_id: z.string().uuid(), body: z.string() }) }),
  z.object({ event: z.literal('typing'), data: z.object({ match_id: z.string().uuid() }) }),
  z.object({
    event: z.literal('message.read'),
    data: z.object({ match_id: z.string().uuid(), up_to_message_id: z.string().uuid() }),
  }),
]);

interface LiveSocket extends WebSocket {
  alive?: boolean;
}

/**
 * Real-time chat at wss://api.amivara.com/ws/chat.
 *
 * Authenticated on connect with the same access token as REST
 * (`Authorization: Bearer …`): the device session must be active and the
 * member verified, or the socket is closed with 4401 / 4403. Every event
 * goes through MessagingService, so the REST and socket paths enforce the
 * same rules (active match, rate limits, encryption at rest).
 */
@Injectable()
export class ChatGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ChatGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly realtime: RealtimeRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter?.getHttpServer() as
      { on(event: 'upgrade', cb: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): void } | undefined;
    if (!server) return;
    server.on('upgrade', (req, socket, head) => {
      const path = (req.url ?? '').split('?')[0];
      if (path !== CHAT_PATH) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => void this.onConnection(ws, req));
    });

    // Drops sockets that stopped answering pings (phones going through tunnels, killed apps).
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients as Set<LiveSocket>) {
        if (ws.alive === false) {
          ws.terminate();
          continue;
        }
        ws.alive = false;
        ws.ping();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  onApplicationShutdown(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }

  private async onConnection(ws: LiveSocket, req: IncomingMessage): Promise<void> {
    // Frames that arrive while the session is checked are queued, not lost.
    const pending: RawData[] = [];
    const state: { handle?: (raw: RawData) => void } = {};
    ws.on('message', (raw) => (state.handle ? state.handle(raw) : pending.push(raw)));

    const auth = await this.authenticate(req, ws);
    if (!auth) return;
    const { userId, sessionId } = auth;

    ws.alive = true;
    ws.on('pong', () => (ws.alive = true));
    ws.on('close', () => this.realtime.remove(userId, ws));
    ws.on('error', () => this.realtime.remove(userId, ws));
    this.realtime.add(userId, ws, sessionId);
    const handle = (raw: RawData) => void this.onFrame(userId, ws, raw);
    state.handle = handle;
    for (const raw of pending.splice(0)) handle(raw);
  }

  /** Same checks as JwtAuthGuard + AgeVerifiedGuard. Returns the member id, or closes the socket. */
  private async authenticate(
    req: IncomingMessage,
    ws: WebSocket,
  ): Promise<{ userId: string; sessionId: string } | undefined> {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      ws.close(CLOSE_UNAUTHENTICATED, 'UNAUTHENTICATED');
      return undefined;
    }
    try {
      const claims = this.tokens.verifyAccess(token);
      const session = await this.prisma.deviceSession.findUnique({
        where: { id: claims.sid },
        select: {
          userId: true,
          revokedAt: true,
          expiresAt: true,
          user: { select: { status: true, ageVerified: true } },
        },
      });
      if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= new Date()) {
        ws.close(CLOSE_UNAUTHENTICATED, 'INVALID_TOKEN');
        return undefined;
      }
      if (['BANNED', 'SUSPENDED', 'PENDING_DELETION'].includes(session.user.status)) {
        ws.close(CLOSE_FORBIDDEN, 'ACCOUNT_SUSPENDED');
        return undefined;
      }
      if (!session.user.ageVerified) {
        ws.close(CLOSE_FORBIDDEN, 'VERIFICATION_REQUIRED');
        return undefined;
      }
      return { userId: session.userId, sessionId: claims.sid };
    } catch {
      ws.close(CLOSE_UNAUTHENTICATED, 'INVALID_TOKEN');
      return undefined;
    }
  }

  private async onFrame(userId: string, ws: WebSocket, raw: RawData): Promise<void> {
    let parsed: z.infer<typeof clientEvent>;
    try {
      const result = clientEvent.safeParse(JSON.parse(raw.toString()));
      if (!result.success) throw new Error('invalid');
      parsed = result.data;
    } catch {
      this.reply(ws, 'VALIDATION_FAILED', 'Unrecognised event.');
      return;
    }
    try {
      switch (parsed.event) {
        case 'message.send':
          await this.messaging.send(userId, parsed.data.match_id, parsed.data.body);
          break;
        case 'typing':
          await this.messaging.typing(userId, parsed.data.match_id);
          break;
        case 'message.read':
          await this.messaging.markRead(userId, parsed.data.match_id, parsed.data.up_to_message_id);
          break;
      }
    } catch (error) {
      if (error instanceof ApiError) {
        this.reply(ws, error.code, error.message);
      } else {
        this.logger.error(`Chat event ${parsed.event} failed: ${(error as Error).message}`);
        this.reply(ws, 'INTERNAL', 'Something went wrong.');
      }
    }
  }

  private reply(ws: WebSocket, code: string, message: string): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ event: 'error', data: { code, message } }));
  }
}
