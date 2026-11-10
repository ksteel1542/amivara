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

## Stage 1: Foundation *(current)*
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

## Stage 4: MVP development
- Sprint 1–2: Auth (OTP), onboarding, 18+ gate, profiles and photos
- Sprint 3: Smile ID integration (Biometric KYC using NIN, Document Verification as the fallback, SmartSelfie™ liveness), verification gating, the manual review queue
- Sprint 4: Location, discovery query, ranking v1
- Sprint 5: Likes, passes, matches, push notifications
- Sprint 6: Messaging (REST + WebSocket), photo unlocking
- Sprint 7–8: Blocking and reporting, admin moderation console, account controls, data export and deletion

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
