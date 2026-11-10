import { type INestApplication, RequestMethod } from '@nestjs/common';

/** Shared HTTP setup for main.ts and the e2e tests, so tests exercise the real routing. */
export function configureApp(app: INestApplication): INestApplication {
  // API.md: base URL is https://api.amivara.com/v1. Health checks stay unprefixed for the ALB.
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();
  return app;
}
