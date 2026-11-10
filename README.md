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
  mobile/          Flutter app (Android only, minSdk 24, AMIVARA ROSE theme)
  web/             Next.js public web app (App Router)
  admin/           Next.js moderation & operations console (internal)
backend/
  src/             NestJS API (modular monolith, Prisma)
  tests/           API e2e tests
database/
  schema/          schema.prisma (source of truth) + migrations/
  tests/           SQL smoke tests for CHECK constraints and PostGIS
  seeds/           Development seed data (never real users)
design/
  brand/           AMIVARA ROSE guidelines + tokens.json
  logos/           Logo brief, source and exports
  ui-components/   Component library designs
infra/terraform/   AWS af-south-1: VPC, RDS PostgreSQL + PostGIS, Redis, S3, CloudFront + WAF
scripts/           generate-tokens.ts (tokens.json → Flutter + CSS)
docs/              Product and engineering documentation
.github/workflows/ CI
```

## Getting started

Requirements: Node 24, pnpm 10 (`corepack enable`), and Flutter 3.38 with the Android SDK and JDK 17 for the mobile app.

```sh
pnpm install                                   # whole TypeScript workspace
pnpm tokens                                    # regenerate theme code after editing design/brand/tokens.json
pnpm --filter @amivara/backend prisma:generate # Prisma client (needed before backend typecheck/tests)
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @amivara/web dev                 # http://localhost:3000
pnpm --filter @amivara/admin dev               # http://localhost:3001
pnpm --filter @amivara/backend start:dev       # http://localhost:4000/health (copy backend/.env.example to .env first)

cd apps/mobile && flutter test && flutter run  # Android device or emulator
```

CI (`.github/workflows/ci.yml`) runs on every push and pull request:
- tokens, lint, format, types, backend tests and all builds
- Prisma migrations against a real PostGIS database, checked for drift
- Flutter analyze, tests and a release AAB
- Terraform fmt and validate

## Documentation

- [Product Requirements](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Database plan](docs/DATABASE.md)
- [API](docs/API.md)
- [Security & safety](docs/SECURITY.md)
- [Roadmap](docs/ROADMAP.md)

## Status

**Stage 3: Technical setup.** All apps are scaffolded, CI is in place and the infrastructure code is written. No infrastructure has been deployed yet. Product features start in Stage 4 (see [ROADMAP](docs/ROADMAP.md)).
