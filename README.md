# AMIVARA

> Real connections between verified adults.

AMIVARA is an **18+ dating and connection platform** built for safety, authenticity and mutual respect. It launches first in **Nigeria** (Lagos and Abuja), then expands across West Africa.

## Brand vision

- **Verified, not anonymous.** Every member is a confirmed adult with a verified phone number and an identity/liveness check before they can message.
- **Mutual by design.** Nobody can message anyone who hasn't shown interest back. Matches are always two-way.
- **Privacy first.** Exact location is never shown. Members control who sees them, and can pause, hide or delete at any time.
- **Made for the market.** Built for Nigerian networks, devices, payment rails and culture: data-light, Android-first, and local in tone.

## Tech stack summary

| Layer | Technology |
|---|---|
| Mobile app | Flutter, **Android-only for the MVP** (iOS after launch) |
| Web app & marketing site | Next.js (React, TypeScript) |
| Admin / moderation console | Next.js (internal, behind SSO) |
| Backend API | NestJS (Node.js, TypeScript), REST + WebSockets |
| Database | PostgreSQL 16 + PostGIS, accessed through **Prisma** ORM |
| Cache / queues / presence | Redis |
| Media storage | S3-compatible object storage + CDN |
| Identity & age verification | **Smile ID** (Biometric KYC, Document Verification, SmartSelfie™ liveness) |
| Phone OTP | SMS + WhatsApp OTP provider with local routing |

## Repository layout

```
apps/
  mobile/          Flutter app
  web/             Next.js public web app
  admin/           Next.js moderation & operations console
backend/
  src/             NestJS API
  tests/           API unit & integration tests
database/
  migrations/      Versioned SQL migrations
  schema/          Reference schema and ERDs
  seeds/           Development seed data (never real users)
design/
  brand/           Brand guidelines, palette, typography
  logos/           Logo source and exports
  ui-components/   Component library designs
docs/              Product and engineering documentation
.github/           CI workflows, issue/PR templates
```

## Documentation

- [Product Requirements](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Database plan](docs/DATABASE.md)
- [API](docs/API.md)
- [Security & safety](docs/SECURITY.md)
- [Roadmap](docs/ROADMAP.md)

## Status

**Stage 1: Foundation.** Documentation and repository structure only. No application code yet.
