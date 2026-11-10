import { Module } from '@nestjs/common';

import { MediaModule } from '../media/media.module';
import { GeoRepository } from './geo.repository';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

/** Profile fields, prompts, interests, languages and the PostGIS location (GeoRepository). */
@Module({
  imports: [MediaModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, GeoRepository],
  exports: [GeoRepository],
})
export class ProfilesModule {}
