import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

import { PrismaClient } from '../../generated/prisma';

/**
 * Single PrismaClient for the API process.
 *
 * Connects lazily on the first query (so the app can boot and report
 * readiness even while the database is still starting), and disconnects
 * on shutdown. PostGIS columns are `Unsupported` in Prisma: spatial reads
 * and writes go through `$queryRaw` / `$executeRaw` tagged templates only.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  /** Lightweight readiness probe used by GET /health/ready. */
  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
