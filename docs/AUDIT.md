# AMIVARA technical audit

**Baseline:** 12 November 2026, commit `3228dc6` (CI and CodeQL green). Update this file as items move.

**Summary.** The core member journey works end to end in code and tests: sign-up, verification, discovery, matching, chat, safety and account controls. What remains is mostly monetisation (billing and Plus), real third-party keys (SMS, Smile ID, Firebase), and admin and production hardening. "Working" means built and green in CI; nothing has run against the real third-party services yet.

Legend: ✅ working · 🟡 partial · ❌ not built

## 1. Backend API (NestJS)

51 routes across 15 controllers. Of the 53 endpoints in `docs/API.md`, 49 are built.

### ✅ Working (integration-tested against PostgreSQL + PostGIS)

| Area | Endpoints |
|---|---|
| Auth | OTP request/verify, refresh rotation with reuse detection, logout, list/revoke devices, sign out other devices |
| Onboarding | 18+ age gate (12-month phone and device block), complete |
| Profile & media | Catalogue, edit, location (rounded to ~100 m), photo upload, confirm, reorder, primary and delete, signed URLs |
| Verification | Smile ID session, signed and idempotent webhook, status, fallback poller, `VERIFICATION_REQUIRED` gate |
| Discovery & matching | PostGIS feed with every PRD filter and the ranking, like/pass, matches list, unmatch |
| Messaging | History, send, read receipts, `/ws/chat` (live delivery, typing), encryption at rest, photo unlock at 3+3 |
| Notifications | FCM token registration, privacy-safe pushes |
| Safety | Block/unblock/list, reports with immutable encrypted evidence, underage auto-suspend |
| Admin | Report queue and detail, dismiss/warn/suspend/ban/unban, audit log |
| Account | Pause, incognito, NDPA data export, deletion with a 30-day grace period and purge |

### 🟡 Partial

- Super Like: `is_super` is accepted but always returns `403 PLUS_REQUIRED`.
- Incognito: works, but is restricted to verified members as a stand-in for Plus.
- OTP delivery: console sender only. Production refuses to boot without a real provider.
- Push: does nothing until the Firebase keys are set.
- WebSocket fan-out: in-process only. More than one API task needs Redis pub/sub.

### ❌ Not built

- [x] `GET/PATCH /me/preferences`: age range, distance, interested-in (done 12 Nov 2026)
- [x] `GET /profiles/:userId`: another member's full profile (done 12 Nov 2026)
- [ ] `POST /matching/rewind`
- [ ] `GET /matching/likes/received` ("who liked you")
- [ ] Billing module (the folder is empty): Plus subscriptions, Paystack, Flutterwave, Google Play billing
- [ ] 30-day auto-pause of unverified accounts
- [ ] Member-facing notices for warnings and suspensions; appeals flow
- [ ] Automated photo moderation and the SmartSelfie face match
- [ ] Photos in chat

## 2. Database

- ✅ 7 migrations (the first 6 listed here), applied in CI and locally: `init`, `auth_onboarding`, `profiles_photos`, `discovery_likes`, `push_tokens`, `safety_moderation`.
- ✅ Constraints enforced in the database itself:
  - the 18+ check and canonical match pair ordering
  - no self-like, self-block or self-report
  - photo slot rules
  - immutable report evidence
  - an append-only audit log
- ✅ Migration 7, `urhobo_language_code`: Urhobo is now `urh` (ISO 639-3); it was stored as `ur`, which is Urdu.
- ❌ Subscription and billing tables.
- 🟡 Reports about a member are deleted with them by the 30-day purge (cascade). A retention decision is needed.

## 3. Android app (Flutter)

17 routes and 87 widget tests. It runs on a physical device against the local API.

### ✅ Working
- Welcome, phone, OTP and age-gate screens
- Onboarding basics
- Profile editor with photos
- The Smile ID flow (explainer, NIN, capture, result)
- Discovery swipe stack (like/pass) and the match modal
- Matches list (unread counts, photo-lock state)
- Chat (live, typing indicator, read ticks, unlock banner)
- Safety & Report menu and report sheet
- Settings & Privacy (pause, incognito, devices, data export, delete account)

### 🟡 Partial
- Location: requested inline from discovery; there's no dedicated permission screen.
- Push: wired, but off without a Firebase config.
- Verification: reports "unavailable" without Smile ID keys.

### ❌ Not built
- [x] Preferences editor: who to see, age range, distance (done 12 Nov 2026)
- [x] Interests and languages pickers (done 12 Nov 2026)
- [x] Block-list management: view and unblock (done 12 Nov 2026)
- [x] Another member's full profile view, from discovery cards and chats (done 12 Nov 2026)
- [ ] Welcome screen hero illustration (waiting for the standalone couple image: `design/hero.png` is the full brand board)
- [ ] Super Like, rewind and "who liked you" UI; Plus paywall and purchase
- [ ] SMS code autofill (SMS User Consent API)
- [ ] iOS (post-launch by decision)

## 4. Admin console and web

- ✅ Admin: staff sign-in, overview counts, report queue, report detail with message context, quick actions.
- ❌ Admin pages linked in the sidebar but still 404: verification reviews, photo moderation, member lookup, audit log.
- ❌ Admin SSO + MFA and an IP allowlist (SECURITY.md §3). Today it's phone OTP plus a staff role.
- 🟡 Web (`apps/web`): landing page only.

## 5. Infrastructure and operations

- 🟡 Terraform (af-south-1): validated in CI but never applied. Secret values aren't set yet: Smile ID, JWT, hash pepper, `message-key`, FCM.
- ❌ Third-party accounts: an SMS/WhatsApp OTP provider, Smile ID sandbox and production keys, a Firebase project.
- 🟡 Local photo uploads need an S3-compatible store (S3 or MinIO). Without one the API returns `503 MEDIA_UNAVAILABLE`.

## 6. Remaining work, by priority

**Launch blockers**
1. [ ] Choose and integrate the SMS/WhatsApp OTP provider
2. [ ] Smile ID sandbox keys and a real end-to-end run
3. [ ] Firebase project and push
4. [ ] Billing and Plus (subscriptions, payment providers, paywall), then move incognito and Super Like behind it
5. [ ] Admin SSO + MFA and an IP allowlist
6. [ ] Apply the Terraform and set the secret values
7. [ ] Stage 5 compliance: DPIA, NDPC registration, penetration test, privacy policy and terms

**User-facing gaps**
- [x] Preferences editor with interests and languages
- [x] Profile view of another member
- [x] Block list
- [ ] Location permission screen
- [ ] Warning and suspension notices
- [ ] Unverified auto-pause
- [ ] The four missing admin pages
- [ ] Welcome hero illustration

**Later**
- [ ] Photos in chat
- [ ] Rewind and "who liked you"
- [ ] Photo moderation and face match
- [ ] Redis fan-out
- [ ] Ranking v2
- [ ] Web member app
