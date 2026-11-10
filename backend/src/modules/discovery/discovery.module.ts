import { Module } from '@nestjs/common';

/**
 * Candidate query (PostGIS ST_DWithin + mutual filters, PRD §6), ranking v1, daily like limits. Verified members only.
 */
@Module({})
export class DiscoveryModule {}
