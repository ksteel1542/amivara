import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { GeoRepository } from '../src/modules/profiles/geo.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage } from './support/members';

/**
 * Sprint 4 integration tests: the PostGIS discovery query (every PRD §6
 * exclusion, radius accuracy in both directions), ranking order, cursor
 * pagination, and likes/passes/matches, against real PostgreSQL + PostGIS.
 *
 * The viewer is a 27-year-old woman in Lagos interested in men aged 22–32
 * (onboarding defaults), 50 km radius.
 */
const LAGOS = { lat: 6.5244, lng: 3.3792 };
/** ~111 km per degree of latitude. */
const north = (km: number) => ({ lat: LAGOS.lat + km / 111.32, lng: LAGOS.lng });

interface Seed {
  name: string;
  at?: { lat: number; lng: number };
  gender?: 'MAN' | 'WOMAN';
  interestedIn?: Array<'MAN' | 'WOMAN'>;
  age?: number;
  ageMin?: number;
  ageMax?: number;
  radiusKm?: number;
  verified?: boolean;
  status?: 'ACTIVE' | 'PAUSED' | 'BANNED';
  deleted?: boolean;
  visible?: boolean;
  photos?: number;
  activeHoursAgo?: number;
}

describe('Discovery and matching (integration, PostgreSQL + PostGIS)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sender = new CapturingSender();
  let token: string;
  let viewerId: string;
  let phoneCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(sender)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(new FakeMediaStorage())
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks RESTART IDENTITY CASCADE`;
    token = await createMember(app, sender); // woman, 27, interested in men, 22–32, 50 km
    viewerId = (await prisma.user.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function placeViewer(at = LAGOS) {
    await http().put('/v1/profiles/me/location').set(auth()).send(at).expect(204);
  }

  async function seed(s: Seed): Promise<string> {
    phoneCounter += 1;
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - (s.age ?? 28));
    dob.setUTCDate(dob.getUTCDate() - 10);
    const user = await prisma.user.create({
      data: {
        phoneE164: `+234905${String(1_000_000 + phoneCounter).slice(-7)}`,
        dateOfBirth: dob,
        ageVerified: s.verified ?? true,
        status: s.status ?? 'ACTIVE',
        deletedAt: s.deleted ? new Date() : null,
        lastActiveAt: new Date(Date.now() - (s.activeHoursAgo ?? 1) * 3600_000),
        profile: { create: { firstName: s.name, gender: s.gender ?? 'MAN', intent: 'RELATIONSHIP' } },
        preference: {
          create: {
            interestedIn: s.interestedIn ?? ['WOMAN'],
            ageMin: s.ageMin ?? 18,
            ageMax: s.ageMax ?? 40,
            maxDistanceKm: s.radiusKm ?? 50,
            showInDiscovery: s.visible ?? true,
          },
        },
      },
    });
    for (let i = 0; i < (s.photos ?? 1); i++) {
      await prisma.profilePhoto.create({
        data: {
          userId: user.id,
          storageKey: `photos/${user.id}/${i}.jpg`,
          contentType: 'image/jpeg',
          status: 'UPLOADED',
          position: i,
        },
      });
    }
    // Profile edits also count as activity; age them to match activeHoursAgo.
    await prisma.$executeRaw`UPDATE profiles SET updated_at = ${new Date(Date.now() - (s.activeHoursAgo ?? 1) * 3600_000)}
                             WHERE user_id = ${user.id}::uuid`;
    const at = s.at ?? north(5);
    await app.get(GeoRepository).setLocation(user.id, at.lat, at.lng);
    return user.id;
  }

  async function feedNames(query = ''): Promise<string[]> {
    const res = await http().get(`/v1/discovery${query}`).set(auth()).expect(200);
    return res.body.cards.map((c: { first_name: string }) => c.first_name);
  }

  // ── Preconditions ─────────────────────────────────────────

  it('asks for a location first', async () => {
    const res = await http().get('/v1/discovery').set(auth()).expect(409);
    expect(res.body.error.code).toBe('LOCATION_REQUIRED');
  });

  it('is open to unverified (browse-only) members and requires sign-in', async () => {
    await placeViewer();
    await seed({ name: 'Tunde' });
    expect(await feedNames()).toEqual(['Tunde']);
    await http().get('/v1/discovery').expect(401);
  });

  // ── Radius (ST_DWithin, both directions) ──────────────────

  it("respects the viewer's radius and the candidate's radius", async () => {
    await placeViewer();
    await seed({ name: 'Near', at: north(5) });
    await seed({ name: 'Thirty', at: north(30) });
    await seed({ name: 'Edge', at: north(48) });
    await seed({ name: 'Sixty', at: north(60) }); // outside the viewer's 50 km
    await seed({ name: 'SmallRadius', at: north(30), radiusKm: 20 }); // the viewer is outside his 20 km

    expect((await feedNames()).sort()).toEqual(['Edge', 'Near', 'Thirty']);
  });

  it('applies a smaller viewer radius', async () => {
    await placeViewer();
    await prisma.preference.update({ where: { userId: viewerId }, data: { maxDistanceKm: 10 } });
    await seed({ name: 'Near', at: north(5) });
    await seed({ name: 'Thirty', at: north(30) });
    expect(await feedNames()).toEqual(['Near']);
  });

  // ── PRD §6 exclusions ─────────────────────────────────────

  it('only shows mutual gender and mutual age matches', async () => {
    await placeViewer();
    await seed({ name: 'Match' });
    await seed({ name: 'AWoman', gender: 'WOMAN', interestedIn: ['WOMAN'] }); // viewer wants men
    await seed({ name: 'WantsMen', interestedIn: ['MAN'] }); // he isn't interested in women
    await seed({ name: 'TooOld', age: 45 }); // outside her 22–32
    await seed({ name: 'WantsYounger', ageMax: 24 }); // she (27) is outside his range
    expect(await feedNames()).toEqual(['Match']);
  });

  it('never shows unverified, inactive, deleted, hidden or photo-less members', async () => {
    await placeViewer();
    await seed({ name: 'Visible' });
    await seed({ name: 'Unverified', verified: false });
    await seed({ name: 'Paused', status: 'PAUSED' });
    await seed({ name: 'Banned', status: 'BANNED' });
    await seed({ name: 'Deleted', deleted: true });
    await seed({ name: 'Hidden', visible: false });
    await seed({ name: 'NoPhotos', photos: 0 });
    expect(await feedNames()).toEqual(['Visible']);
  });

  it('removes liked, passed, blocked (either way) and matched members', async () => {
    await placeViewer();
    await prisma.user.update({ where: { id: viewerId }, data: { ageVerified: true } });
    const liked = await seed({ name: 'Liked' });
    const passed = await seed({ name: 'Passed' });
    const blockedByMe = await seed({ name: 'BlockedByMe' });
    const blockedMe = await seed({ name: 'BlockedMe' });
    const matched = await seed({ name: 'Matched' });
    await seed({ name: 'Fresh' });

    await http().post('/v1/matching/likes').set(auth()).send({ user_id: liked }).expect(201);
    await http().post('/v1/matching/passes').set(auth()).send({ user_id: passed }).expect(204);
    await prisma.block.create({ data: { blockerId: viewerId, blockedId: blockedByMe } });
    await prisma.block.create({ data: { blockerId: blockedMe, blockedId: viewerId } });
    const [a, b] = viewerId < matched ? [viewerId, matched] : [matched, viewerId];
    await prisma.match.create({ data: { userAId: a, userBId: b } });

    expect(await feedNames()).toEqual(['Fresh']);
  });

  it('a pass expires after 30 days', async () => {
    await placeViewer();
    const passed = await seed({ name: 'Passed' });
    await http().post('/v1/matching/passes').set(auth()).send({ user_id: passed }).expect(204);
    expect(await feedNames()).toEqual([]);
    await prisma.pass.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await feedNames()).toEqual(['Passed']);
  });

  // ── Ranking v1 ────────────────────────────────────────────

  it('ranks closer and more recently active members first', async () => {
    await placeViewer();
    await seed({ name: 'FarStale', at: north(45), activeHoursAgo: 24 * 30 });
    await seed({ name: 'NearStale', at: north(3), activeHoursAgo: 24 * 30 });
    await seed({ name: 'FarActive', at: north(45), activeHoursAgo: 0.1 });
    await seed({ name: 'NearActive', at: north(3), activeHoursAgo: 0.1 });

    // Near+active beats everything; far+stale loses to everything. (The middle two
    // differ by less than the 5% daily shuffle, so their order is not asserted.)
    const order = await feedNames();
    expect(order).toHaveLength(4);
    expect(order[0]).toBe('NearActive');
    expect(order[3]).toBe('FarStale');
  });

  // ── Payload and pagination ────────────────────────────────

  it('returns cards with signed photos and a coarse distance, never coordinates', async () => {
    await placeViewer();
    const id = await seed({ name: 'Emeka', at: north(7), photos: 3 });
    await prisma.profile.update({
      where: { userId: id },
      data: { bio: 'Engineer, foodie.', prompts: [{ prompt_id: 'green_flag', answer: 'Kindness.' }] },
    });

    const res = await http().get('/v1/discovery').set(auth()).expect(200);
    const card = res.body.cards[0];
    expect(card).toMatchObject({
      user_id: id,
      first_name: 'Emeka',
      age: 28,
      verified: true,
      bio: 'Engineer, foodie.',
      prompts: [{ prompt_id: 'green_flag', prompt: 'The green flag I look for…', answer: 'Kindness.' }],
    });
    expect(card.photos).toHaveLength(3);
    expect(card.photos[0].url).toContain('?signed=1');
    expect(card.distance.label).toMatch(/^(\d+ km away|Less than 2 km away)$/);
    expect(card.distance.km).toBeGreaterThanOrEqual(5);
    expect(card.distance.km).toBeLessThanOrEqual(9);

    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/"lat"|"lng"|location|dist_m|date_of_birth|phone/);
  });

  it('pages through every candidate exactly once with the cursor', async () => {
    await placeViewer();
    const names = ['Ade', 'Bayo', 'Chidi', 'Dayo', 'Ebuka'];
    for (const [i, name] of names.entries()) await seed({ name, at: north(2 + i * 8) });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
      const res = await http().get(`/v1/discovery${query}`).set(auth()).expect(200);
      seen.push(...res.body.cards.map((c: { first_name: string }) => c.first_name));
      cursor = res.body.next_cursor;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen.sort()).toEqual(names);
  });

  it('rejects a tampered cursor', async () => {
    await placeViewer();
    const res = await http().get('/v1/discovery?cursor=bm90LWEtY3Vyc29y').set(auth()).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  // ── Likes, matches ────────────────────────────────────────

  it('likes need verification; a mutual like creates exactly one match', async () => {
    await placeViewer();
    const him = await seed({ name: 'Kunle' });

    const gated = await http().post('/v1/matching/likes').set(auth()).send({ user_id: him }).expect(403);
    expect(gated.body.error.code).toBe('VERIFICATION_REQUIRED');

    await prisma.user.update({ where: { id: viewerId }, data: { ageVerified: true } });
    await prisma.like.create({ data: { likerId: him, likeeId: viewerId } }); // he liked her first

    const res = await http().post('/v1/matching/likes').set(auth()).send({ user_id: him }).expect(201);
    expect(res.body).toMatchObject({ matched: true });
    expect(await prisma.match.count()).toBe(1);

    // Liking again is idempotent.
    await http().post('/v1/matching/likes').set(auth()).send({ user_id: him }).expect(201);
    expect(await prisma.match.count()).toBe(1);
  });

  it('a one-sided like is not a match; Super Likes need Plus; blocked members are unavailable', async () => {
    await placeViewer();
    await prisma.user.update({ where: { id: viewerId }, data: { ageVerified: true } });
    const him = await seed({ name: 'Segun' });
    const blocked = await seed({ name: 'Blocked' });
    await prisma.block.create({ data: { blockerId: blocked, blockedId: viewerId } });

    const res = await http().post('/v1/matching/likes').set(auth()).send({ user_id: him }).expect(201);
    expect(res.body).toEqual({ matched: false, match_id: null });

    const superLike = await http()
      .post('/v1/matching/likes')
      .set(auth())
      .send({ user_id: him, is_super: true })
      .expect(403);
    expect(superLike.body.error.code).toBe('PLUS_REQUIRED');

    await http().post('/v1/matching/likes').set(auth()).send({ user_id: blocked }).expect(404);
    await http().post('/v1/matching/likes').set(auth()).send({ user_id: viewerId }).expect(400);
  });
});
