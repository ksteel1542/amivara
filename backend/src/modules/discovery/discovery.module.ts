import { Module } from '@nestjs/common';

import { MediaModule } from '../media/media.module';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryRepository } from './discovery.repository';
import { DiscoveryService } from './discovery.service';

/** Candidate query (PostGIS ST_DWithin + PRD §6 mutual filters) and ranking v1. */
@Module({
  imports: [MediaModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryRepository, DiscoveryService],
})
export class DiscoveryModule {}
