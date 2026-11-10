import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  async function build(reachable: boolean): Promise<HealthController> {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: { isReachable: jest.fn().mockResolvedValue(reachable) } }],
    }).compile();
    return moduleRef.get(HealthController);
  }

  it('reports liveness without touching the database', async () => {
    const controller = await build(false);
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('reports ready when the database is reachable', async () => {
    const controller = await build(true);
    await expect(controller.ready()).resolves.toEqual({ status: 'ok', database: 'up' });
  });

  it('returns 503 when the database is unreachable', async () => {
    const controller = await build(false);
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
