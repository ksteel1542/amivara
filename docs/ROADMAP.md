# AMIVARA: Roadmap

**Status:** Draft v0.2. Durations are indicative and will be set once the team size is confirmed.

**Locked decisions:** Smile ID (KYC and liveness) · Prisma ORM · Android-only Flutter MVP plus Next.js web. iOS is a post-launch milestone (Stage 8) · AWS `af-south-1` with CloudFront Lagos edges · "Verify later" (browse open, like and message need verification) · `design/brand/tokens.json`.

| # | Stage | Indicative duration | Exit criteria |
|---|---|---|---|
| 1 | Foundation | 1–2 weeks | Repo, docs, decisions signed off |
| 2 | Brand & UI prototypes | 3–4 weeks | Clickable Figma prototype tested with 10+ target users |
| 3 | Technical setup | 2 weeks | CI/CD, environments, skeleton apps deployed to staging |
| 4 | MVP development | 10–12 weeks | All MVP features in PRD §5 complete |
| 5 | Trust, safety & compliance | 3 weeks (overlaps 4) | DPIA, pen test, moderation operations ready |
| 6 | Testing & closed beta | 4 weeks | Beta KPIs met, no open SEV1/SEV2 bugs |
| 7 | Nigerian launch | 2–4 weeks | Public on Google Play (Android) and the web, Lagos and Abuja marketing live |
| 8 | Growth & expansion | Ongoing | iOS release, Plus tier, new cities, then West Africa |

## Stage 1: Foundation
- [x] Repository structure and foundation docs
- [ ] Founder review and sign-off of the PRD, architecture and security
- [x] Decision: KYC provider → **Smile ID**
- [x] Decision: ORM → **Prisma**
- [x] Decision: MVP platform → **Android-only (Flutter) plus Next.js web. iOS after launch.**
- [x] Initial Prisma schema (`database/schema/schema.prisma`): User, Profile, Verification, Match, Message
- [x] Decision: cloud region → **AWS Cape Town (`af-south-1`) with CloudFront Lagos edge locations**
- [x] Decision: verification gating → **"verify later" allowed. Browsing is open, liking and messaging need Smile ID.**
- [ ] Create the AWS Organization (`dev`, `staging` and `prod` accounts), **turn on the `af-south-1` opt-in region**, set up billing alerts
- [ ] Sign the Smile ID commercial agreement and DPA. Get sandbox API keys and agree per-check pricing.
- [ ] Google Play Console developer account (organisation) and the dating-app policy declaration
- [ ] Register the domain, trademark search for "AMIVARA" in Nigeria (NIPO)
- [ ] Engage Nigerian counsel (terms, NDPA registration)

## Stage 2: Brand & UI prototypes
- [x] AMIVARA ROSE palette, typography and voice → `design/brand/AMIVARA_ROSE.md`
- [x] Design tokens → `design/brand/tokens.json`
- [x] Onboarding and verification wireframes spec → `docs/UI_WIREFRAMES.md`
- [x] Logo & brand identity brief → `design/logos/LOGO_BRIEF.md`
- [ ] Logo and app icon design (rounds 1–4 in the brief) → `design/logos`
- [ ] Browse-only ("verify later") states: the Like button's verification prompt, the persistent banner, the 30-day auto-pause notice
- Wireframes, then hi-fi screens: onboarding, verification, discovery, match, chat, safety, settings. Android (Material 3) and responsive web layouts only.
- Design the Smile ID verification moments: the pre-check explainer, SmartSelfie™ capture guidance, and the failure and retry screens
- A component library → `design/ui-components`
- Usability tests in Lagos and Abuja, with a focus on how clear verification is and how safe people feel

## Stage 3: Technical setup
- [x] pnpm monorepo with shared TypeScript, ESLint (flat config) and Prettier rules
- [x] NestJS skeleton: 12 feature modules, Prisma wiring, env validation (zod), `/health` + `/health/ready`, and the `@RequireAgeVerified()` gate (PRD §5.3a) with unit and e2e tests
- [x] Flutter Android skeleton (`com.amivara.app`, minSdk 24, portrait only, ROSE launch background), ROSE Material 3 theme, Welcome screen, widget tests including 200% font scale
- [x] Next.js web and admin skeletons (App Router, ROSE tokens, next/font, security headers, admin noindex)
- [x] Theme code generated from `design/brand/tokens.json` (`scripts/generate-tokens.ts` → Flutter `ColorScheme`/`TextTheme` and CSS variables), with CI failing if the generated code is stale
- [x] First Prisma migration (`database/schema/migrations/20261110000000_init`) with the raw-SQL CHECK constraints. CI applies it to PostGIS, checks for drift and runs constraint smoke tests.
- [x] GitHub Actions CI: workspace (tokens, lint, format, typecheck, tests, builds), database, Android (analyze, test, release AAB artifact), Terraform (fmt, validate)
- [x] Terraform for **`af-south-1`**: VPC, RDS PostgreSQL 16, ElastiCache Redis, S3 media, CloudFront (Lagos edges, OAC, signed URLs) and the edge WAF. **Written but not applied.**
- [x] Terraform: ECS Fargate (api, web, admin, ARM64) and ALB, web and API CloudFront distributions, ACM and Route 53, SES, Secrets Manager entries, CloudWatch alarms, GitHub OIDC deploy role (deploy-only, no infra rights). **Written but not applied.**
- [ ] Register the domain, then apply staging (needs the AWS Organization and the `af-south-1` opt-in region enabled, Stage 1 task). Steps: infra/terraform/README.md
- [ ] CD: deploy pipeline, `prisma migrate deploy` release step, Android AAB to the Play internal testing track (needs the Play Console account and an upload key)
- [x] CodeQL (TypeScript and GitHub Actions, security-extended, weekly) and Dependabot (npm, pub, GitHub Actions, Terraform; grouped, framework majors held back)
- [x] Bundle the brand fonts in the Android app: Playfair 600/700 and Inter 400/500/600 as static subsets with full Yoruba, Igbo and Hausa coverage and ₦ (`scripts/fonts/build_fonts.py`, tests in `apps/mobile/test/fonts_test.dart`)
- [ ] Smile ID sandbox wired end to end: job signature endpoint, callback webhook, Flutter and Web SDK smoke test (needs sandbox keys)

## Stage 4: MVP development *(current)*
- Sprint 1 ✅ (code complete, 2026-11-10): Phone OTP auth (API + Android screens 2a/2b), rotating device sessions, the 18+ gate with 12-month underage blocks (screens 3/3x), profile basics and account creation, GET /me, and the browse-only home placeholder.
  - Open: choose the SMS/WhatsApp OTP provider (only a dev console sender exists, and production refuses to boot without a real one). Also the Android SMS User Consent API for one-tap code autofill.
- Sprint 2 ✅ (code complete, 2026-11-10): Profile editing API (bio, intent, up to 5 prompts, interests, languages, height) with DB CHECKs; photos via S3 presigned POST (6 slots, signature-verified confirm, reorder, main photo, remove with a minimum of 2); PostGIS location with ~100 m rounding; Android profile editor (drag-to-reorder grid, ≤ 300 KB on-device compression, prompts, bio, intent) and the Smile ID explainer (screen 4).
  - Open: automated photo moderation (e.g. Rekognition) and the face match against the SmartSelfie; a location permission screen in the app (the API is ready); interests and languages pickers in the app (the API is ready).
- Sprint 3 ✅ (code complete, 2026-11-10): Smile ID Biometric KYC: signed sessions, the signature-verified idempotent webhook, the job_status fallback poller, a pure decision function (passed / manual review / failed / under-18 ban), the `VERIFICATION_REQUIRED` gate on likes and messages; Android NIN entry (screenshots blocked), Smile ID SDK capture, checking and result screens (gold-badge celebration, review, retry).
  - Open: Smile ID sandbox keys and a real end-to-end run, confirming the `Actions` decision against real sandbox payloads; Document Verification as a fallback for members without a NIN; the admin manual-review queue (sprints 7–8); push notification when a result arrives.
- Sprint 4 ✅ (code complete, 2026-11-11): Discovery: the PostGIS candidate query with every PRD §6 filter (both radii, mutual gender and age, verified-only, liked, passed, blocked and matched excluded), ranking v1 (distance, activity, age fit, completeness, small shuffle), a keyset cursor and coarse, jittered distance labels. Likes (verified only, 50 a day, a mutual like creates a match) and passes (30 days). Android swipe stack with photo carousels, the gold badge, the verify prompt for unverified likes, a match dialog and a coarse-location step.
  - Open: the blocking and reporting UI (sprint 7); widening the radius in the app; a ranking v2 that learns from engagement.
- Sprint 5 ✅ (code complete, 2026-11-11): Matches list (unread counts, last message), final unmatch (no rematch, gone from discovery both ways), domain events, FCM HTTP v1 push without firebase-admin (privacy: generic match notifications with no names, silent unmatch refresh), push tokens bound to device sessions. Android matches screen, unmatch confirmation, "It's a Match!" modal, FCM registration on sign-in.
  - Open: a Firebase project plus the `fcm` secret (push is off until then); a push for verification results; migrating the app to `register()`/`onRegistered` (Firebase Installation IDs) once the FCM v1 sender is confirmed against them.
- Sprint 6 ✅ (code complete, 2026-11-10): Messaging over REST (`/v1/matches/:id/messages`, read receipts) and the `/ws/chat` WebSocket (live delivery, typing, read receipts, unmatch closes open chats). Bodies AES-256-GCM encrypted at rest, a 30/min send limit, generic "new message" pushes only when the recipient is offline. Progressive photo unlocking once both members have sent 3 messages. Android chat screen (ROSE bubbles, typing indicator, read ticks, unlock progress, REST fallback, paging older messages); lock state on the matches list.
  - Open: the `message-key` secret value; sending photos in chat; Redis pub/sub fan-out before running more than one API task; re-checking open sockets when a session is revoked or a member is banned.
- Sprint 7 ✅ (code complete, 2026-11-10, briefed as "Stage 5: Trust, Safety & Admin Moderation"): Blocking (both-way exclusion, archives the match, closes open chats) and reporting with an immutable, encrypted evidence snapshot (profile plus the last 50 messages); underage reports suspend at once. Admin moderation API (queue, evidence, dismiss / warn / temporary suspend / permanent ban / unban) with enforcement history and an append-only audit log. Bans revoke every session, close sockets and blacklist the phone and device HMACs. Moderation console in `apps/admin` (OTP sign-in for staff, review queue, report detail with message context, quick actions). Android "Safety & Report" menu on discovery cards and in chat, with the ReportUserSheet.
  - Open: SSO + MFA and the IP allowlist for the console (SECURITY.md §3), currently phone OTP plus a staff role; a member-facing notice for warnings and suspensions; an appeals flow; the other console queues (verification reviews, photo moderation, member lookup, audit log viewer).
- Sprint 8: Account controls (pause, incognito, sessions), data export and deletion

## Stage 5: Trust, safety & compliance
- DPIA, appoint a DPO, NDPC registration
- External penetration test and fixes
- Moderation playbooks, 24/7 cover for underage reports, moderator training
- Privacy policy, terms and community guidelines published

## Stage 6: Testing & closed beta
- QA on a matrix of low and mid-range Android devices (Tecno, Infinix, itel, Samsung A-series), on 3G network conditions, and across the main web browsers
- Measure Smile ID pass rates and drop-off on real devices and in different lighting conditions
- A closed beta with 500–1,000 invited adults in Lagos
- Target KPIs: 60% or more verified within 7 days, a falling report rate, crash-free sessions at 99.5% or more

## Stage 7: Nigerian launch
- Google Play release (Nigeria storefront) and the public web app, then the Lagos and Abuja launch campaigns
- Launch-week war room, with on-call cover for both engineering and safety

## Stage 8: Growth & expansion
- **iOS release:** turn on the Flutter iOS target, integrate the Smile ID iOS SDK, add APNs, StoreKit billing and App Store review
- AMIVARA Plus (Google Play Billing on Android, Paystack/Flutterwave on web), more cities
- Diaspora mode, then Ghana as the next market
- Ranking v2 and an annual transparency report
