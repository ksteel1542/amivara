import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';

/** Server → client chat events (docs/API.md "Messaging"). */
export type ChatEvent =
  | { event: 'message.new'; data: Record<string, unknown> }
  | { event: 'message.read'; data: { match_id: string; up_to_message_id: string; read_at: string } }
  | { event: 'typing'; data: { match_id: string; user_id: string } }
  | { event: 'photos.unlocked'; data: { match_id: string } }
  | { event: 'match.removed'; data: { match_id: string } }
  | { event: 'error'; data: { code: string; message: string } };

/**
 * Open chat sockets per member (a member may be connected from several devices).
 * In-process: correct for one API instance. With several ECS tasks, fan-out
 * moves to Redis pub/sub (ARCHITECTURE.md §4) behind this same interface.
 */
@Injectable()
export class RealtimeRegistry {
  private readonly sockets = new Map<string, Set<WebSocket>>();
  /** The device session behind each socket, so signing a device out closes its socket. */
  private readonly sessionOf = new WeakMap<WebSocket, string>();

  add(userId: string, socket: WebSocket, sessionId?: string): void {
    if (sessionId) this.sessionOf.set(socket, sessionId);
    const set = this.sockets.get(userId) ?? new Set<WebSocket>();
    set.add(socket);
    this.sockets.set(userId, set);
  }

  remove(userId: string, socket: WebSocket): void {
    const set = this.sockets.get(userId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.sockets.delete(userId);
  }

  isOnline(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  /** Sends to every open socket of the member. Returns how many received it. */
  send(userId: string, event: ChatEvent): number {
    let delivered = 0;
    const payload = JSON.stringify(event);
    for (const socket of this.sockets.get(userId) ?? []) {
      if (socket.readyState === socket.OPEN) {
        socket.send(payload);
        delivered++;
      }
    }
    return delivered;
  }

  /** Closes the sockets opened with any of these device sessions. */
  disconnectSessions(userId: string, sessionIds: string[], code: number, reason: string): void {
    const ids = new Set(sessionIds);
    for (const socket of this.sockets.get(userId) ?? []) {
      const sid = this.sessionOf.get(socket);
      if (sid && ids.has(sid)) socket.close(code, reason);
    }
  }

  /** Closes every socket of a member (ban, logout everywhere). */
  disconnect(userId: string, code: number, reason: string): void {
    for (const socket of this.sockets.get(userId) ?? []) socket.close(code, reason);
  }
}
