import { type INestApplication, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Express } from 'express';

import { ApiExceptionFilter } from './common/api-exception.filter';
import type { Env } from './config/env';

/** Shared HTTP setup for main.ts and the tests, so tests exercise the real routing. */
export function configureApp(app: INestApplication): INestApplication {
  // API.md: base URL is https://api.amivara.com/v1. Health checks stay unprefixed for the ALB.
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });

  // Every error uses API.md's `{ error: { code, message, details } }` envelope.
  app.useGlobalFilters(new ApiExceptionFilter());

  // Behind CloudFront + ALB (2 hops), so req.ip is the member's address for rate limiting.
  const hops = app.get<ConfigService<Env, true>>(ConfigService).get('TRUST_PROXY_HOPS', { infer: true });
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', hops);

  // JSON bodies keep their raw bytes too: payment and LiveKit webhooks are signed over the
  // exact body. Registered before init, so Nest skips its own JSON parser (same 100kb limit).
  (app as NestExpressApplication).useBodyParser('json', {
    limit: '100kb',
    // LiveKit posts its webhooks as application/webhook+json.
    type: ['application/json', 'application/webhook+json'],
    verify: (req: object, _res: unknown, buf: Buffer) => {
      (req as { rawBody?: Buffer }).rawBody = buf;
    },
  });

  app.enableShutdownHooks();
  return app;
}
