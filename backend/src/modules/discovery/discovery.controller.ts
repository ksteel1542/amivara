import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember } from '../auth/auth.guards';
import { DiscoveryService } from './discovery.service';

const feedQuery = z
  .object({
    cursor: z.string().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(20).default(10),
  })
  .strict();

/**
 * GET /v1/discovery: the ranked card stack (API.md "Discovery").
 * Open to every signed-in member, verified or not: browsing is free (PRD §5.3a);
 * only liking and messaging need verification.
 */
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get()
  feed(
    @CurrentMember() member: AuthenticatedMember,
    @Query(new ZodValidationPipe(feedQuery)) query: z.infer<typeof feedQuery>,
  ) {
    return this.discovery.feed(member.id, query);
  }
}
