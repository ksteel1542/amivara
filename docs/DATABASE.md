# AMIVARA: Database Schema Plan

**Engine:** PostgreSQL 16 + PostGIS 3 · **ORM:** Prisma · **Status:** Draft v0.2

Conventions: `uuid` primary keys, `timestamptz` columns, `snake_case` names, soft deletion through `deleted_at` where it applies, and every schema change made through versioned migrations in `database/schema/migrations/`.

## 0. Prisma

- **Source of truth:** [`database/schema/schema.prisma`](../database/schema/schema.prisma). Models use camelCase and map to the snake_case tables below through `@map` / `@@map`.
- **Migrations:** `prisma migrate dev` locally, `prisma migrate deploy` in CI/CD. SQL lives in `database/schema/migrations/`, and the first migration is `20261110000000_init`. `database/tests/constraints.sql` checks the hand-written CHECK constraints in CI.
- **PostGIS:** turned on through the `postgresqlExtensions` preview feature (`extensions = [postgis, pgcrypto]`). The `location` column is `Unsupported("geography(Point, 4326)")` with `@@index([location], type: Gist)`. Prisma Client can't read or write `Unsupported` fields, so spatial access goes through `$queryRaw` / `$executeRaw` tagged templates in a `GeoRepository`.
- **Raw SQL that Prisma can't express:** the CHECK constraints (18+ DOB, match pair ordering, message content, profile bounds). These are added to migrations created with `--create-only`, and the full list is at the end of `schema.prisma`.
- **UUIDs:** Prisma generates v4 UUIDs in the application (`@default(uuid())`). If index locality becomes a problem we can move to v7 (`uuid(7)` in Prisma 5.18+).

### Schema v0.1 scope and how it differs from the plan below
The first `schema.prisma` covers **User, Profile, Verification, Match and Message**. To keep the first version small:
- `user_locations` is **merged into `profiles`** (`location`, `geohash5`, `location_updated_at`), because it's a one-to-one table anyway.
- `conversations` is **merged into `matches`** (`photos_unlocked`, `last_message_at`). Messages reference `match_id` directly.
- `verifications` gains Smile ID fields: `provider_job_id` (unique, so callbacks are idempotent), `provider_ref` (SmileJobID), `result_code`, `result_text`, `id_type`, `verified_adult` and `dob_matches`.

The remaining tables below (preferences, likes, passes, blocks, reports, enforcement actions, device sessions, subscriptions, audit log, profile photos) come in the next iteration of the schema.

## 1. Entity overview

```
users 1─1 profiles 1─* profile_photos
users 1─1 preferences
users 1─1 user_locations
users 1─* verifications
users 1─* device_sessions
users *─* users  via likes / passes / blocks / reports
matches 1─1 conversations 1─* messages
users 1─* subscriptions
```

## 2. Tables

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| phone_e164 | text UNIQUE NOT NULL | Normalised, e.g. `+2348012345678` |
| phone_verified_at | timestamptz | |
| date_of_birth | date NOT NULL | `CHECK (date_of_birth <= now() - interval '18 years')` |
| age_verified | boolean NOT NULL DEFAULT false | Set only by the verification module |
| status | enum `user_status` | `active`, `paused`, `suspended`, `banned`, `pending_deletion` |
| role | enum `user_role` | `member`, `moderator`, `admin` |
| created_at, updated_at, last_active_at, deleted_at | timestamptz | |

### `profiles`
| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK FK→users | |
| first_name | text NOT NULL | |
| gender | enum `gender` | `woman`, `man`, `non_binary` |
| bio | varchar(500) | |
| intent | enum `intent` | `relationship`, `friendship`, `casual`, `not_sure` |
| city | text | |
| height_cm, education, job_title, religion | | Optional |
| languages | text[] | |
| interests | text[] | Up to 10 |
| prompts | jsonb | `[{prompt_id, answer}]`, up to 3 |
| completeness_score | smallint | Computed |

### `profile_photos`
`id`, `user_id`, `storage_key`, `position (0–5)`, `moderation_status (pending/approved/rejected)`, `face_match_score`, `created_at`. Unique on `(user_id, position)`.

### `preferences`
| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK FK | |
| interested_in | gender[] NOT NULL | |
| age_min | smallint NOT NULL | `CHECK (age_min >= 18)` |
| age_max | smallint NOT NULL | `CHECK (age_max >= age_min AND age_max <= 99)` |
| max_distance_km | smallint NOT NULL DEFAULT 50 | 1–300 |
| intents | intent[] | Optional filter |
| show_me_in_discovery | boolean DEFAULT true | |
| incognito | boolean DEFAULT false | Premium |

### `user_locations`
| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK FK | |
| location | geography(Point,4326) NOT NULL | Rounded to about 100 m before it's stored |
| geohash5 | text | Coarse cell used for caching and sharding |
| city | text | Reverse-geocoded |
| updated_at | timestamptz | |

Indexes:
- `GIST (location)`, for `ST_DWithin` radius queries.
- `BTREE (geohash5)`.

Retention: we keep only the latest location, with no location history.

### `verifications`
`id`, `user_id`, `type (phone_otp/biometric_kyc/document_verification/smart_selfie)`, `provider (smile_id/internal)`, `provider_job_id`, `provider_ref`, `status (pending/passed/failed/manual_review/expired)`, `result_code`, `result_text`, `id_type`, `verified_age_band`, `verified_adult`, `dob_matches`, `failure_reason`, `attempt`, `created_at`, `completed_at`. The provider is **Smile ID**. Raw ID images and full NIN numbers are **not stored** (see SECURITY.md).

### `likes`
`liker_id`, `likee_id`, `is_super`, `created_at`. PK `(liker_id, likee_id)`. Index on `(likee_id, created_at)` for "who liked me".

### `passes`
`passer_id`, `passee_id`, `created_at`, `expires_at`. PK `(passer_id, passee_id)`.

### `matches`
`id`, `user_a_id`, `user_b_id` (with `CHECK user_a_id < user_b_id`), `created_at`, `unmatched_at`, `unmatched_by`. Unique on `(user_a_id, user_b_id)`.

### `conversations`
`id`, `match_id UNIQUE`, `last_message_at`, `photos_unlocked boolean`.

### `messages`
`id`, `conversation_id`, `sender_id`, `type (text/image/system)`, `body`, `media_key`, `moderation_status`, `created_at`, `read_at`, `deleted_at`. Index on `(conversation_id, created_at DESC)`. We'll partition by month once there's enough volume.

### `blocks`
`blocker_id`, `blocked_id`, `created_at`. PK on the pair. Both directions are excluded from discovery and messaging.

### `reports`
`id`, `reporter_id`, `reported_id`, `category`, `details`, `message_id?`, `status (open/actioned/dismissed)`, `priority`, `assigned_to`, `resolved_at`. `underage` reports are always `priority = critical`.

### `enforcement_actions`
`id`, `user_id`, `action (warn/suspend/ban/unban)`, `reason`, `actor_id`, `report_id?`, `created_at`, `expires_at`.

### `device_sessions`
`id`, `user_id`, `refresh_token_hash`, `device_info`, `ip_hash`, `created_at`, `last_used_at`, `revoked_at`.

### `subscriptions`
`id`, `user_id`, `plan`, `provider (google_play/paystack/flutterwave)`, `provider_ref`, `status`, `current_period_end`. `app_store` is added with the iOS release.

### `audit_log`
An append-only record of every admin action and sensitive data access: `actor_id`, `action`, `target_type`, `target_id`, `metadata jsonb`, `created_at`.

## 3. Discovery query (sketch)

```sql
SELECT p.user_id
FROM user_locations ul_me
JOIN preferences pr_me ON pr_me.user_id = :me
JOIN profiles pf_me    ON pf_me.user_id = :me
JOIN users u_me        ON u_me.id = :me
JOIN user_locations ul ON ST_DWithin(ul.location, ul_me.location, pr_me.max_distance_km * 1000)
JOIN users u           ON u.id = ul.user_id
JOIN profiles p        ON p.user_id = u.id
JOIN preferences pr    ON pr.user_id = u.id
WHERE ul_me.user_id = :me
  AND u.id <> :me
  AND u.status = 'active' AND u.age_verified
  AND pr.show_me_in_discovery AND NOT pr.incognito
  AND p.gender = ANY(pr_me.interested_in)
  AND pf_me.gender = ANY(pr.interested_in)
  AND date_part('year', age(u.date_of_birth)) BETWEEN pr_me.age_min AND pr_me.age_max
  AND date_part('year', age(u_me.date_of_birth)) BETWEEN pr.age_min AND pr.age_max
  AND ST_DWithin(ul.location, ul_me.location, pr.max_distance_km * 1000)
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id, b.blocked_id) IN ((:me, u.id), (u.id, :me)))
  AND NOT EXISTS (SELECT 1 FROM likes  l WHERE l.liker_id = :me AND l.likee_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM passes s WHERE s.passer_id = :me AND s.passee_id = u.id AND s.expires_at > now())
  AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.user_a_id = LEAST(:me, u.id) AND m.user_b_id = GREATEST(:me, u.id))
LIMIT 200;
```

Ranking happens in the application on the returned set.

This query runs through Prisma's `$queryRaw` tagged template, so `:me` becomes a bound `${userId}` parameter. With schema v0.1, the `user_locations` joins read `profiles.location` instead.

## 4. Seeds

`database/seeds/` contains only **synthetic** adult profiles (fictional names, generated avatars, random points around Lagos and Abuja). No real personal data ever goes into seeds.
