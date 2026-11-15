# AMIVARA monetisation, calls and earnings: plan

**Status:** decisions recorded 15 Nov 2026 (section 2a). M1 in progress.
**Prerequisite:** done. The email-first / progressive-trust work is on `main` (`04bb8ed`). Its call flags (`voice_calls`, `video_calls`) and verification gate are the foundation for this plan.

## 1. What we already have

- **Verification gate.** `GET /me` returns `capabilities`, and the server enforces them. Calls and earning plug into the same flags.
- **Live connection.** Chat runs over the `/ws/chat` WebSocket, which can also carry call signalling (ring / accept / decline / end).
- **Push.** The FCM sender exists. No Firebase project is set up yet.
- **Money-safe database habits.**
  - CHECK constraints and triggers enforce rules in the database itself.
  - The audit log is append-only.
  - Webhooks are idempotent (the Smile ID webhook already works this way).
- **Gap: no legal names.** Smile ID results are stored without the member's legal name (data minimisation). Matching a payout account to the "verified NIN name" means storing that name. That needs a DPIA / privacy-policy update.

## 2. Decisions needed before building (M0)

1. **Google Play payments policy: the biggest risk.**
   - As I understand Google Play's policy, virtual currency bought and used inside an Android app must use **Google Play Billing** (15–30% fee).
   - Selling coins through Paystack or OPay checkout inside the Play-distributed app risks the app being removed.
   - Common setups:
     - **(a)** Play Billing in the app, plus Paystack top-ups on the web.
     - **(b)** A link out to web checkout, only where Google's programmes allow it.
   - **Confirm Nigeria's current status with Google's policy pages or a lawyer.** This decides what M2 contains.
2. **Licensing and tax.**
   - Creators cashing out makes AMIVARA a payments marketplace.
   - Using Paystack (a licensed provider) for collections and transfers helps.
   - Still check with Nigerian counsel:
     - CBN rules on holding member balances
     - VAT on digital sales
     - withholding tax on creator payouts
3. **Who can earn.**
   - Restricting earning to verified **women** carries discrimination and app-store review risk.
   - **Recommended:** an opt-in **Host** role open to any verified member. Onboarding and marketing can still target women.
4. **Safety minimums.** Paid chat and calls attract solicitation, exploitation and off-platform payment. Minimums:
   - in-call report and block
   - no recording without both people's consent
   - contact-exchange flags feeding into fraud scoring
   - spend and earn caps in the first days
   - held earnings before withdrawal
5. **Brand.** Paid messaging shifts the "real connections" positioning. Align the copy and the PRD with whatever is decided.
6. **Numbers.**
   - **Coin packages:** e.g. 500 / 2,000 / 10,000 / 30,000 coins, with first-purchase bonuses.
   - **Prices:** the price of a paid message, each gift (Rose, Kiss) and a call minute.
   - **Host terms:** the host revenue share, the payout minimum and the earnings hold period (e.g. 7 days).

## 2a. Decisions (15 Nov 2026)

1. **Checkout is dual-ready.**
   - A `PaymentProvider` interface with two implementations:
     - **Paystack** (card, bank transfer, USSD; OPay wallet users pay by bank transfer) for the direct APK, the web and immediate NGN testing.
     - **Google Play Billing** for the Play Store release build.
   - The provider is chosen per build (a Flutter `--dart-define`) and enforced by the API (`PAYMENT_PROVIDERS` lists which are accepted).
   - A purchase only credits coins after server-side verification with the provider it came from: Paystack's verify transaction, or Google's Purchases API.
2. **Earning is an opt-in "Verified Host" mode** for any NIN-verified member. No gender rule anywhere in code or data.
3. **Free starter coins** for new members (section 3a).
4. **Live "Chat House" rooms** for Verified Hosts (section 3b), built on the same LiveKit setup as 1:1 calls.

Still open: the legal and tax review (section 2, point 2), final prices and revenue share (point 6), and the privacy update for storing verified legal names (needed by M7).

## 3. Proposed architecture

### Money ledger (API and Postgres)

- **Double-entry.** Every movement is a balanced set of entries (debits equal credits). A database CHECK enforces it per transaction.
- **Whole numbers only.** Coins are whole numbers and naira are stored in kobo, never floats.
- **Idempotency key** on every payment, spend and payout. A repeated webhook or a retried request can never credit twice.
- **Balances** are derived from the ledger, with a cached balance column kept in step and checked.

### Payments (recommended: Paystack)

- **Top-up:**
  1. The app calls the API, which creates a `payment_intent` and calls Paystack's **transaction initialise** endpoint.
  2. The member pays by **card, bank transfer or USSD**. OPay wallet users pay by bank transfer.
  3. Paystack sends a webhook, checked with the `x-paystack-signature` header (HMAC-SHA512).
  4. The API calls **verify transaction** and only then credits the coins.
  5. A nightly reconciliation job compares our records with Paystack's.
- **Payouts:** Paystack **Transfers**.
  - Resolve the account name (`/bank/resolve`) and fuzzy-match it to the verified name.
  - OPay accounts are ordinary account numbers (NUBANs), so OPay wallets are covered.
- **Direct OPay Cashier:** can be added later behind the same `PaymentProvider` interface.

### Calls (recommended: LiveKit)

| | LiveKit (recommended) | Agora |
|---|---|---|
| Hosting | Self-host in af-south-1, or LiveKit Cloud | Their global network (likely better African edge coverage) |
| Cost | Server cost (+ Cloud fees if used) | Per-minute pricing |
| Lock-in | Open source, none | Proprietary |
| Server control (billing enforcement) | Full | Less |
| Flutter SDK | Good | Mature |

- **Signalling:** the existing WebSocket (ring / accept / decline / end).
- **Incoming calls:** FCM high-priority pushes, plus Android full-screen notifications for a closed app.
- **Gating:** `capabilities.voice_calls` / `video_calls` (verified members only).
- **Billing runs on the server, never the phone.**
  1. At call start the server holds 1 minute of coins.
  2. It deducts each minute.
  3. With 1 minute left it sends a low-balance event, and the app opens the in-call top-up sheet.
  4. At zero the server ends the call through LiveKit's RoomService.
  5. LiveKit's join/leave webhooks correct the duration if anything breaks.

### 3a. Free starter coins

- **The grant.** A new member gets a one-time grant of **promo coins** once they've accepted the community guidelines.
  - The amount is set by `STARTER_COINS`; the placeholder is 100.
  - It's granted on their first wallet load, idempotent per member.
- **Once per device.** A device that has already claimed a grant can't claim another (its device hash is recorded, HMAC only), so throwaway accounts don't farm coins.
- **Two kinds of coins.**
  - **Promo coins** (starter grants, promotions) and **paid coins** (bought) are separate ledger accounts.
  - Spending uses promo coins first.
  - **Promo coins never become Host earnings.** Otherwise someone could farm free coins with throwaway accounts and cash them out through their own Host account. Only the paid part of a spend creates earnings.
- **Running out.** When the balance can't cover an action, the API answers `402 INSUFFICIENT_COINS`. The app then opens the top-up sheet in place, in the chat, call or room.

### 3b. Live "Chat House" rooms (LiveKit)

- **What it is.** A Verified Host opens a room: audio, or audio plus video.
  - **Seats:** the host plus up to N guest speaker seats (placeholder 8). Everyone else listens.
  - **Guest seats:** members request a seat and the host (or the host's moderators) accepts it. Speakers must be verified.
- **Followers.** Members can follow Hosts. A room can be **open** or **followers only**.
  - The host can mute, move a speaker back to the audience, remove someone, or ban them from the room.
  - Room-level reports go to the admin queue.
- **Gifts.** In-room gifts (Rose, Kiss…) are spent from the sender's coins. The paid part becomes earnings for the recipient: the host, or a guest who is also a Host.
- **Tech.** One LiveKit room per Chat House. Seat permissions come from LiveKit token grants (`canPublish` only for seated speakers); seat changes go through the API, which updates participant permissions via RoomService.
- **Safety.**
  - Rooms are live only, with no recording.
  - Every room carries a visible report button.
  - Contact-exchange detection runs on room chat messages.
  - A room closes when its host leaves or is suspended.

### 3c. Prices (final, 15 Nov 2026)

| Package | Price | First-purchase bonus | Label |
|---|---|---|---|
| 500 coins | ₦1,000 | +100 | |
| 2,000 coins | ₦3,500 | +400 | Most popular |
| 10,000 coins | ₦15,000 | +2,000 | |
| 30,000 coins | ₦40,000 | +7,500 | |

Starter coins: **100** per new member and device. Still to set: the price of a paid message, each gift and a call minute, and the Host revenue share.

### 3d. Host icebreakers (one-tap conversation starters)

- **What it is.** Verified Hosts see a horizontal bar of conversation starters above the composer, tailored to the other member's profile: shared interests, city, prompts. Tapping one fills the box; long-press sends it straight away.
- **How they're made.** Templates first (e.g. "You're into {interest} too: what got you started?"), filled from the profile fields the member chose to show.
  - Never from private data: no location beyond the city they wrote, and nothing from other chats.
  - An LLM-written variant can come later behind the same endpoint.
- **API.** `GET /v1/matches/:id/icebreakers` returns 3–5 suggestions. Host-only, rate-limited. Starters are suggestions, so normal chat billing and safety scanning apply to whatever is sent.

### 3e. AI Companion personas (clearly labelled)

**What it is.** Profiles with `is_ai_companion = true` that reply 24/7 through an LLM hook.
- **Billing.** Messages to an AI Companion cost coins like any paid message, and **100% is kept by the platform**: the spend goes to `PLATFORM_REVENUE` with no earnings entries.
- **No humans.** No Host or payout account can ever be attached to an AI persona.

**Disclosure.** The label is what makes this compliant. Deception is what Google Play, Paystack and consumer law object to.
- **Everywhere:** a visible **"AI Companion"** badge on the card, the full profile, the chat header and every message bubble, and in the matches list.
- **First message:** the first message of every conversation states it's an AI.
- **Never claims to be human:** the persona never claims to be human, and answers truthfully if asked.
- **Separate from real people:** AI Companions are shown in their own discovery section or tab, never mixed into the real-member stack as if they were people, and never counted as "matches".

**Wellbeing.** These guard against designing to keep lonely members spending:
- **No pressure:** the model is never asked to push purchases, guilt-trip, invent urgency or reference the member's balance.
- **Spending limits:** members can set a daily cap (default off), and a 7-day self-exclusion is available.
- **New members:** a soft daily cap applies to AI chat spend for the first week.
- **Content:** no sexual content or nudity (Play policy). The safety scanning and reporting used in real chats apply here too.
- **No collecting data:** the persona never asks for personal data, contact details, money or gifts.

**Data and logging.**
- **Data.** Conversations go to the LLM provider under a data-processing agreement. This needs a DPIA and privacy-policy update, and a provider region and retention setting that suit NDPA.
- **Logging.** Prompts and responses are logged for safety review, with the member able to delete them with their account.

**Before launch.**
- **Policy check:** confirm AI-companion monetisation against Google Play's AI-generated content policy and Paystack's restricted-business list. **Not legal advice: verify.**
- **Provider:** pick the LLM (provider, model and region). It's a separate decision with its own cost per message.

## 4. Database outline (new tables)

| Table | Purpose and key columns |
|---|---|
| `coin_packages` | `id, coins, price_kobo, bonus_coins, first_purchase_bonus, active, sort` |
| `ledger_accounts` | `id, owner_id?, kind, currency, balance` (cached, kept in step by a trigger): member_coins_paid / member_coins_promo / member_earnings_pending / member_earnings_available / platform_revenue / platform_promo / platform_adjustments / gateway_clearing / payout_clearing. Member balances can never go below 0 (CHECK) |
| `ledger_entries` | `id, account_id, amount` (signed integer), `currency` (COIN / NGN), `txn_id`. Balanced per transaction (database CHECK) |
| `transactions` | `id, kind` (topup / message / gift / call_minute / payout / refund / adjustment), `idempotency_key UNIQUE, status, metadata` |
| `payment_intents` | `id, user_id, package_id, provider, provider_ref UNIQUE, amount_kobo, status, paid_at, verify_payload` |
| `gifts` / `gift_sends` | Catalogue (Rose, Kiss: coin price) / sends between members, linked to a transaction |
| `call_sessions` | `id, match_id, caller_id, callee_id, kind` (voice/video), `rate_coins_per_min, state, started_at, ended_at, billed_minutes, end_reason` |
| `host_profiles` | `user_id, available_for_calls, revenue_share_bps, earning_since, payout_hold_days` |
| `payout_accounts` | `user_id, bank_code, account_number_hash + last4, resolved_name, name_match_score, provider_recipient_code, verified_at` |
| `payout_requests` | `id, user_id, amount_kobo, status` (pending / approved / sent / failed / reversed), `provider_transfer_code, reviewed_by` |
| `disputes` | `id, txn_id, user_id, reason, status, resolution` |
| `promo_claims` | `subject` (HMAC of a device or account) `UNIQUE, kind` (starter), `user_id, created_at`: one starter grant per device |
| `follows` | `follower_id, host_id, created_at`: follower-only rooms and notifications |
| `chat_houses` | `id, host_id, title, mode` (audio / video), `audience` (open / followers), `state, livekit_room, started_at, ended_at` |
| `chat_house_seats` | `house_id, seat_no, user_id, role` (host / speaker / moderator), `joined_at` |
| `chat_house_bans` | `house_id, user_id, by_id, created_at` |
| `users.is_ai_companion` | Boolean flag; AI personas can never own Host or payout records (CHECK / trigger) |
| `spend_limits` | `user_id, daily_cap_coins, ai_daily_cap_coins, self_excluded_until` |

## 5. Milestones (each shippable, each with its own tests)

| # | Milestone | Contents | Key tests |
|---|---|---|---|
| M0 | Decisions | Section 2 answered; prices and shares set | — |
| M1 | Coin ledger, starter coins, wallet API (no real money) | Double-entry ledger, coin packages (placeholder prices), promo vs paid coins, starter grant (once per device), `GET /v1/wallet` and transactions, audited admin adjustments, internal spend (promo first) | Entries always balance, no overdraft under concurrency, idempotency, one starter grant per device |
| M2 | Top-ups ✅ (Paystack; Play Billing pending) | Paystack and/or Play Billing (per M0) in test mode, webhook, verify, reconciliation, in-chat top-up sheet, "Payment successful" dialog | Forged and duplicate webhooks, first-purchase bonus |
| M3 | Spending and earning ✅ (paid messages; gifts pending) | Paid messages, gifts (Rose, Kiss), host revenue split into pending earnings, hold period, basic earnings view | Split arithmetic, refunds |
| M3a | Host icebreakers ✅ | `GET /v1/matches/:id/icebreakers` (templates from shared profile fields), Flutter starter bar for Hosts | Host-only, no private data used, rate limit |
| M3b | AI Companion personas ✅ (OpenAI gpt-4o-mini) | `is_ai_companion` flag, badge on every surface, own discovery section, LLM hook (provider TBD) with safety filters, 100% platform revenue, spend caps and self-exclusion | Label always present, no earnings entries, caps enforced, never claims to be human |
| M4 | Calls without billing | LiveKit tokens, WS ringing, incoming-call push and full-screen notification, call screen, in-call report/block, gating | Gating, ring timeouts, decline/busy |
| M5 | Per-minute billing | Server ticks, 1-minute warning, in-call top-up, auto-hangup at zero | Dropped connections, mid-minute disconnects, clock edge cases |
| M6 | Host hub | Opt-in Host role, "Available for calls", call/gift/message history, earnings dashboard | Role gating, availability in discovery |
| M7 | Payouts | Bank/OPay account (resolve + NIN name match), withdrawal requests, admin approval queue, Paystack transfers and webhooks, reversals | Name mismatch, insufficient available earnings, reversed transfers |
| M8b | Chat House rooms | Follows, rooms, seats, LiveKit permissions, in-room gifts, follower-only rooms, host moderation | Seat permissions, bans, gift splits |
| M8 | Fraud and operations | Velocity limits, chargebacks, admin finance pages, anomaly alerts | Limits and alerts |

**M1 doesn't depend on the payment-provider decision**, so it can start as soon as M0's numbers exist (or with placeholders).
