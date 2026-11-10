import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/** Load balancer / ECS health checks. Excluded from the /v1 prefix. */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: the API can reach PostgreSQL. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; database: 'up' }> {
    if (!(await this.prisma.isReachable())) {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
    return { status: 'ok', database: 'up' };
  }
}
