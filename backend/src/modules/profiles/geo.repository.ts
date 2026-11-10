import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/** ~100 m: 0.001° of latitude is 111 m; of longitude at Nigeria's latitudes, ~109–111 m. */
const PRECISION = 1000;

export function roundCoordinate(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

/**
 * The only place that reads or writes PostGIS columns. Prisma models
 * `profiles.location` as Unsupported, so this uses tagged-template raw SQL
 * (always parameterised). Only the latest, rounded point is kept: there is
 * no location history (SECURITY.md §5).
 */
@Injectable()
export class GeoRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Stores the member's location rounded to ~100 m. Returns false if the member has no profile. */
  async setLocation(userId: string, lat: number, lng: number): Promise<boolean> {
    const rLat = roundCoordinate(lat);
    const rLng = roundCoordinate(lng);
    const updated = await this.prisma.$executeRaw`
      UPDATE profiles
         SET location = ST_SetSRID(ST_MakePoint(${rLng}::float8, ${rLat}::float8), 4326)::geography,
             geohash5 = ST_GeoHash(ST_SetSRID(ST_MakePoint(${rLng}::float8, ${rLat}::float8), 4326), 5),
             location_updated_at = now(),
             updated_at = now()
       WHERE user_id = ${userId}::uuid`;
    return updated > 0;
  }

  /** Whether a location is on file (the point itself is never returned to clients). */
  async hasLocation(userId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ has: boolean }>>`
      SELECT location IS NOT NULL AS has FROM profiles WHERE user_id = ${userId}::uuid`;
    return rows[0]?.has ?? false;
  }
}
