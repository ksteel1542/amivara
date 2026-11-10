import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Who is calling, as far as rate limiting and session records need to know.
 * `ip` comes from Express's `req.ip`, which honours `trust proxy` (set from
 * TRUST_PROXY_HOPS, so the client IP is read correctly behind CloudFront + ALB).
 */
export interface RequestContext {
  ip: string | undefined;
  /** Client-generated install id (X-Device-Id), used for per-device limits and blocks. */
  deviceId: string | undefined;
  platform: 'android' | 'ios' | 'web' | undefined;
  deviceModel: string | undefined;
}

const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;
const PLATFORMS = new Set(['android', 'ios', 'web']);

export function contextFromRequest(req: Request): RequestContext {
  const deviceId = req.header('x-device-id');
  const platform = req.header('x-platform')?.toLowerCase();
  const model = req.header('x-device-model');
  return {
    ip: req.ip,
    deviceId: deviceId && DEVICE_ID.test(deviceId) ? deviceId : undefined,
    platform: platform && PLATFORMS.has(platform) ? (platform as RequestContext['platform']) : undefined,
    deviceModel: model ? model.slice(0, 100) : undefined,
  };
}

/** `@Ctx() ctx: RequestContext` in controllers. */
export const Ctx = createParamDecorator((_: unknown, context: ExecutionContext): RequestContext => {
  return contextFromRequest(context.switchToHttp().getRequest<Request>());
});
