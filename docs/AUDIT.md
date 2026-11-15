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
- Code delivery: console senders only. Production needs a real **email** provider to boot (email is the primary sign-in since Nov 2026). Without an SMS provider, phone sign-in is simply off.
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

## 7. Change log

### 13–15 Nov 2026: email-first sign-up and progressive trust

Founder decision, superseding "unverified = browse only":

- [x] **Email OTP and Google Sign-In are primary.** `POST /auth/email/request`, `POST /auth/google`; phone sign-in stays as a secondary option.
  - Production now needs an **email provider** (e.g. Amazon SES), not an SMS gateway. Without an SMS provider, phone sign-in is simply off.
  - Under-18 and ban blocks cover the email or phone **and** the device.
- [x] **Unverified members** appear in discovery (no badge), like, match and send up to 10 text messages a day.
  - Chat photos unlock only between two verified members.
  - `GET /me` `capabilities` gates voice and video calls on verification, ready for when calls are built.
- [x] **Community guidelines** screen once after sign-up, before discovery (`POST /me/guidelines/accept`).
- [x] **Off-platform contact flagging** in chat. It detects phone numbers, emails, handles and messaging apps; the message is delivered but logged in `safety_events`, and both members see a reminder.
- [x] Welcome copy no longer claims every member is verified.
- [x] Migration 8, `email_signup_progressive_trust`:
  - optional phone, unique lower-cased email, `guidelines_accepted_at`
  - `safety_events`
  - CHECKs that a member has a phone or an email, and that a code has one destination
- [ ] Email provider (Amazon SES sender plus domain SPF/DKIM). **This is the launch blocker now**, instead of SMS.
- [ ] Google OAuth client ids (Google Cloud console), then set `GOOGLE_CLIENT_IDS` (API) and `GOOGLE_SERVER_CLIENT_ID` (app build). Until then the Google button is hidden.
- [ ] Add a phone number later from Settings (optional, verified by SMS when a provider exists).
- [ ] Admin console view of `safety_events` (repeat contact-sharers).

### 15 Nov 2026: monetisation milestone 1 (coin ledger)

- [x] Double-entry ledger (`ledger_accounts`, `ledger_transactions`, `ledger_entries`). The database enforces:
  - each transaction balances per currency (deferred constraint trigger)
  - no member overdraft (CHECK on the trigger-maintained balance)
  - append-only history
  - one platform account per kind
- [x] Coin packages (placeholder prices) with first-purchase bonus.
- [x] Promo vs paid coins: promo coins are spent first and never become Host earnings.
- [x] Starter coins once per member and per device, after the guidelines are accepted.
- [x] `GET /v1/wallet`, `GET /v1/wallet/transactions`, `POST /v1/admin/users/:id/coins` (audited).
- [x] A purged member's ledger accounts lose their owner, so financial history is kept.
- [x] Final package prices and `STARTER_COINS` = 100 (15 Nov 2026).

### 15–16 Nov 2026: monetisation milestone 2 (top-ups)

- [x] `payment_intents` (CHECKs: NGN only, positive amounts, succeeded ⇔ linked ledger transaction).
- [x] `PaymentProvider` interface: Paystack client (initialize, verify, HMAC-SHA512 webhook signatures), Google Play placeholder (503 until wired). `PAYMENT_PROVIDERS` env; live keys refused outside production and test keys in production.
- [x] `POST /v1/wallet/topups`, `GET /v1/wallet/topups/:id`, `POST /v1/payments/paystack/webhook`, return page, reconciler.
- [x] Exactly-once crediting (row lock, per-member advisory lock, ledger idempotency key); first-purchase bonus once, as promo coins; amount mismatches held.
- [x] Flutter: coin chip in chat, top-up sheet (naira packages, "Most popular", first-purchase bonus), Paystack in a Custom Tab, polling and on-resume check, "Payment successful" dialog, opens on `402 INSUFFICIENT_COINS` (REST and socket).
- [x] Terraform: `paystack` secret container, injected when `payments_enabled = true`.
- [ ] Paystack test-mode keys and a dashboard webhook URL, then an end-to-end sandbox payment on the phone.
- [ ] Google Play Billing (Android Publisher API purchase verification), for the Play Store build.
- [ ] Daily settlement comparison against Paystack's transaction list (the reconciler covers unfinished top-ups only).

