# AMIVARA: Roadmap

**Status:** Draft v0.1. Durations are indicative and will be set once the team size is confirmed.

| # | Stage | Indicative duration | Exit criteria |
|---|---|---|---|
| 1 | Foundation | 1–2 weeks | Repo, docs, decisions signed off |
| 2 | Brand & UI prototypes | 3–4 weeks | Clickable Figma prototype tested with 10+ target users |
| 3 | Technical setup | 2 weeks | CI/CD, environments, skeleton apps deployed to staging |
| 4 | MVP development | 10–12 weeks | All MVP features in PRD §5 complete |
| 5 | Trust, safety & compliance | 3 weeks (overlaps 4) | DPIA, pen test, moderation operations ready |
| 6 | Testing & closed beta | 4 weeks | Beta KPIs met, no open SEV1/SEV2 bugs |
| 7 | Nigerian launch | 2–4 weeks | Public on Play Store, Lagos and Abuja marketing live |
| 8 | Growth & expansion | Ongoing | iOS, Plus tier, new cities, then West Africa |

## Stage 1: Foundation *(current)*
- [x] Repository structure and foundation docs
- [ ] Founder review and sign-off of the PRD, architecture and security
- [ ] Decisions: KYC provider, cloud region, ORM (Prisma or TypeORM), whether iOS ships at MVP
- [ ] Register the domain, trademark search for "AMIVARA" in Nigeria (NIPO)
- [ ] Engage Nigerian counsel (terms, NDPA registration)

## Stage 2: Brand & UI prototypes
- Logo, palette, typography and voice → `design/brand`, `design/logos`
- Wireframes, then hi-fi screens: onboarding, verification, discovery, match, chat, safety, settings
- A component library → `design/ui-components`
- Usability tests in Lagos and Abuja, with a focus on how clear verification is and how safe people feel

## Stage 3: Technical setup
- Flutter, Next.js (web and admin) and NestJS skeletons, plus a shared lint and format setup
- Terraform for dev and staging. PostgreSQL + PostGIS, Redis and object storage
- GitHub Actions: lint, test, build, deploy. CodeQL and Dependabot
- Initial migrations from `docs/DATABASE.md`

## Stage 4: MVP development
- Sprint 1–2: Auth (OTP), onboarding, 18+ gate, profiles and photos
- Sprint 3: KYC and liveness integration, verification gating
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
- QA on a matrix of low and mid-range Android devices, and on 3G network conditions
- A closed beta with 500–1,000 invited adults in Lagos
- Target KPIs: 60% or more verified within 7 days, a falling report rate, crash-free sessions at 99.5% or more

## Stage 7: Nigerian launch
- Google Play release (Nigeria storefront), then the Lagos and Abuja launch campaigns
- Launch-week war room, with on-call cover for both engineering and safety

## Stage 8: Growth & expansion
- iOS release, AMIVARA Plus (Paystack/Flutterwave), more cities
- Diaspora mode, then Ghana as the next market
- Ranking v2 and an annual transparency report
