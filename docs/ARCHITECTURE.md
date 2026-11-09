# AMIVARA: Architecture Overview

**Status:** Draft v0.1

## 1. System diagram

```
 ┌────────────────┐   ┌────────────────┐   ┌────────────────────┐
 │ Flutter mobile │   │ Next.js web    │   │ Next.js admin      │
 │ (Android/iOS)  │   │ (public)       │   │ (moderation, SSO)  │
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
          │ Object store │ │ KYC/liveness │ │ SMS/WhatsApp │ │ FCM / APNs   │
          │ + CDN        │ │ provider     │ │ OTP provider │ │ push         │
          └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

## 2. Clients

### Mobile (Flutter), `apps/mobile`
- State management: Riverpod. Navigation: go_router.
- Networking: Dio with an auth interceptor (access and refresh tokens). WebSocket for chat.
- Local storage: flutter_secure_storage for tokens, and Drift/SQLite to cache chats offline.
- Images: compressed on the device (target ≤ 300 KB) before upload, and loaded progressively through the CDN.
- Android-first, with minSdk 24 to cover the long tail of devices in Nigeria.

### Web (Next.js), `apps/web`
- App Router and TypeScript. Includes the marketing site, legal pages, and later a web version of the app.
- Pages are server-rendered for SEO. The authenticated app uses the same API.

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
| `verification` | KYC/liveness session creation, provider webhooks, age assurance |
| `discovery` | Candidate query (PostGIS and mutual filters), ranking, daily limits |
| `matching` | Likes, passes, match creation, unmatch |
| `messaging` | Conversations, messages, WebSocket gateway, read receipts |
| `safety` | Reports, blocks, automated flags, enforcement |
| `media` | Signed upload URLs, image processing and moderation pipeline |
| `notifications` | Push, in-app and SMS notifications |
| `billing` | Subscriptions, Paystack/Flutterwave and store receipts |
| `admin` | Admin-only endpoints, audit logging |

Cross-cutting:
- Prisma (or TypeORM) for data access, plus raw SQL for PostGIS queries.
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

**Verification:** the client asks for a KYC session, the provider SDK runs on the device, and the provider sends a webhook to `/verification/webhook`. The API checks the signature, stores the result and sets `age_verified`, which unlocks interactions.

## 6. Infrastructure

- Containers (Docker) on a managed platform. We recommend AWS `af-south-1` (Cape Town) or GCP `africa-south1` for latency, with a CDN that has Lagos edge POPs.
- Environments: `dev`, `staging`, `prod`. Infrastructure as code with Terraform.
- CI/CD with GitHub Actions: lint, test, build and deploy. Mobile builds go through Codemagic or Fastlane.
- Backups: PostgreSQL point-in-time recovery, daily snapshots kept for 30 days, and quarterly restore drills.

## 7. Non-functional targets

| Metric | Target |
|---|---|
| API p95 latency (excluding media) | < 300 ms |
| Message delivery p95 | < 1 s |
| Availability | 99.5% at MVP, 99.9% after launch |
| App cold start (mid-range Android) | < 3 s |
| Data used per discovery session | < 5 MB |
