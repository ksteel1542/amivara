# AMIVARA: Architecture Overview

**Status:** Draft v0.2

**Decisions in effect:** Smile ID (KYC and liveness) · Prisma ORM · Android-only Flutter MVP plus Next.js web (iOS after launch).

## 1. System diagram

```
 ┌────────────────┐   ┌────────────────┐   ┌────────────────────┐
 │ Flutter mobile │   │ Next.js web    │   │ Next.js admin      │
 │ (Android only) │   │ (public)       │   │ (moderation, SSO)  │
 └───────┬────────┘   └───────┬────────┘   └─────────┬──────────┘
         │ HTTPS / WSS        │                      │ (VPN/SSO)
         └──────────┬─────────┴──────────────────────┘
                    ▼
          ┌───────────────────┐        ┌──────────────────────┐
          │ API gateway / LB  │──────▶ │ NestJS API (stateless│
          │ TLS, rate limits  │        │ REST + WebSocket)    │
          └───────────────────┘        └───┬──────┬──────┬────┘
                                           │      │      │
             ┌─────────────────────────────┘      │      └──────────────┐
             ▼                                    ▼                     ▼
   ┌──────────────────┐              ┌───────────────────┐   ┌────────────────────┐
   │ PostgreSQL 16 +  │              │ Redis             │   │ Workers (BullMQ)   │
   │ PostGIS          │              │ cache, sessions,  │   │ moderation, push,  │
   │ (primary + read  │              │ presence, pub/sub │   │ KYC webhooks, email│
   │  replica)        │              └───────────────────┘   └─────────┬──────────┘
   └──────────────────┘                                                │
                                                                       ▼
          ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
          │ Object store │ │ Smile ID     │ │ SMS/WhatsApp │ │ FCM push     │
          │ + CDN        │ │ KYC/liveness │ │ OTP provider │ │ (Android/web)│
          └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

## 2. Clients

### Mobile (Flutter), `apps/mobile`
- State management: Riverpod. Navigation: go_router.
- Networking: Dio with an auth interceptor (access and refresh tokens). WebSocket for chat.
- Local storage: flutter_secure_storage for tokens, and Drift/SQLite to cache chats offline.
- Images: compressed on the device (target ≤ 300 KB) before upload, and loaded progressively through the CDN.
- **Android only for the MVP.** minSdk 24, so it runs on the long tail of older devices in Nigeria. Distributed through Google Play (Nigeria storefront). The project is set up so the `ios/` target can be turned on after launch without restructuring, but no iOS builds, signing or App Store work happens before then.
- Identity verification: the official **Smile ID Flutter SDK** (Android) for SmartSelfie™, document capture and Biometric KYC. The SDK uploads straight to Smile ID, so ID images never pass through AMIVARA servers.
- Push: Firebase Cloud Messaging only. APNs comes with iOS.

### Web (Next.js), `apps/web`
- App Router and TypeScript. Includes the marketing site, legal pages, and later a web version of the app.
- Pages are server-rendered for SEO. The authenticated app uses the same API.
- During the MVP this is the main way to reach the product for people who aren't on Android. Smile ID verification on web uses the **Smile ID Web SDK / hosted web integration**.

### Admin (Next.js), `apps/admin`
- Moderation queues (reports, photos, verification reviews), user lookup, enforcement actions and an audit log viewer.
- Only reachable through SSO and an IP allowlist or VPN. Access is role-based: `moderator`, `senior_moderator`, `admin`.

## 3. Backend (NestJS), `backend/`

A modular monolith. The modules share one deployable but have clear boundaries, so they can be split out later.

| Module | Responsibility |
|---|---|
| `auth` | OTP request and verify, JWT issue and refresh, device sessions |
| `users` | Account lifecycle, settings, pause and delete |
| `profiles` | Profile fields, photos, prompts |
| `verification` | Smile ID job creation (signature/token issuing), Smile ID callback handling, age assurance. Smile ID sits behind a `VerificationProvider` interface |
| `discovery` | Candidate query (PostGIS and mutual filters), ranking, daily limits |
| `matching` | Likes, passes, match creation, unmatch |
| `messaging` | Conversations, messages, WebSocket gateway, read receipts |
| `safety` | Reports, blocks, automated flags, enforcement |
| `media` | Signed upload URLs, image processing and moderation pipeline |
| `notifications` | Push, in-app and SMS notifications |
| `billing` | Subscriptions: Google Play Billing (Android) and Paystack/Flutterwave (web) |
| `admin` | Admin-only endpoints, audit logging |

Cross-cutting:
- **Prisma** for data access and migrations. The schema lives at `database/schema/schema.prisma`, migrations at `database/migrations/`. Prisma has no native geography type, so PostGIS columns are declared as `Unsupported("geography(Point,4326)")` with a GiST index. Spatial reads and writes go through `$queryRaw` / `$executeRaw` (tagged templates only, so they're always parameterised) inside a dedicated `GeoRepository`. CHECK constraints that Prisma can't express (such as the 18+ rule) are added in hand-edited SQL migrations.
- class-validator DTOs and global validation pipes.
- Rate limiting with a Redis-backed throttler.
- OpenTelemetry tracing, structured JSON logs (with PII redaction) and Sentry.

## 4. Data

- **PostgreSQL 16 + PostGIS**: the system of record. `geography(Point,4326)` columns with GiST indexes for radius queries.
- **Redis**: OTP throttling, session denylist, presence, the discovery candidate cache, BullMQ queues and WebSocket pub/sub fan-out.
- **Object storage** (S3-compatible): private buckets that are reached only through short-lived signed URLs or a CDN with signed cookies.

## 5. Key flows

**Discovery:** the client calls `GET /discovery/candidates`. The API reads cached candidates from Redis, and on a cache miss it runs the PostGIS query with mutual filters, ranks the results, caches 50 IDs and returns 10 hydrated cards.

**Like → Match:** `POST /matching/likes`. A transaction inserts the like and checks whether the other person already liked back. If they did, it creates the match and conversation, emits `match.created`, and pushes a notification to both members.

**Verification (Smile ID):**
1. The client calls `POST /verification/sessions`. The API creates a `Verification` row (`PENDING`) and returns the Smile ID partner parameters (`user_id`, `job_id`, `job_type`) plus a server-generated signature or token. The Smile ID API key never leaves the server.
2. The Smile ID SDK captures the SmartSelfie™ (and the document, or the NIN for Biometric KYC) and submits the job directly to Smile ID.
3. Smile ID calls back to `POST /verification/webhook`. The API verifies the callback signature and timestamp, finds the job by `job_id`, saves the result code and DOB-derived age band, and sets `users.age_verified = true` only if the result passed **and** the verified age is 18 or over.
4. If the callback is late, a worker polls Smile ID's job status endpoint as a fallback. Callbacks are idempotent, keyed on the Smile ID job ID.

## 6. Infrastructure

- Containers (Docker) on a managed platform. We recommend AWS `af-south-1` (Cape Town) or GCP `africa-south1` for latency, with a CDN that has Lagos edge POPs.
- Environments: `dev`, `staging`, `prod`. Infrastructure as code with Terraform.
- CI/CD with GitHub Actions: lint, test, build and deploy. `prisma migrate deploy` runs as a separate release step before the API rolls out. Android builds (AAB) go to the Play Console internal, closed and production tracks through Fastlane or Codemagic.
- Backups: PostgreSQL point-in-time recovery, daily snapshots kept for 30 days, and quarterly restore drills.

## 7. Non-functional targets

| Metric | Target |
|---|---|
| API p95 latency (excluding media) | < 300 ms |
| Message delivery p95 | < 1 s |
| Availability | 99.5% at MVP, 99.9% after launch |
| App cold start (mid-range Android) | < 3 s |
| Android APK download size (per ABI) | < 30 MB |
| Data used per discovery session | < 5 MB |
