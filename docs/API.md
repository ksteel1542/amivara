# AMIVARA: API Definition (v1)

**Base URL:** `https://api.amivara.com/v1` · **Format:** JSON · **Status:** Draft v0.1

## Conventions

- Auth: `Authorization: Bearer <access_token>`. The access token is a JWT that lasts 15 minutes. The refresh token is opaque, rotates on every use and lasts 30 days.
- Errors look like `{ "error": { "code": "STRING_CODE", "message": "Human readable", "details": {} } }`.
- Pagination is cursor-based: `?cursor=<opaque>&limit=20`, and responses include `next_cursor`.
- Idempotency: write endpoints accept an `Idempotency-Key` header.
- Rate limits are returned in `X-RateLimit-*` headers. Going over a limit returns `429`.
- Gate legend: 🔓 public · 🔑 authenticated · ✅ authenticated **and** age-verified.

## Auth

*Implemented in Stage 4, sprint 1.* Clients send `X-Device-Id` (a random install id) and `X-Platform` on every request. The API uses them for per-device limits and session records.

| Method | Path | Gate | Description |
|---|---|---|---|
| POST | `/auth/otp/request` | 🔓 | Body `{ phone, channel: "sms" \| "whatsapp" }`. Returns `202 { challenge_id, channel, expires_in: 300, resend_in }`. Same response whether or not the number has an account. |
| POST | `/auth/email/request` | 🔓 | *(Nov 2026, primary)* Body `{ email }`. Sends a 6-digit code; `202 { challenge_id, channel: "email", expires_in: 300, resend_in }`. Same response whether or not the address has an account. Same limits as phone codes (per address, device and IP). `400 INVALID_EMAIL`. |
| POST | `/auth/google` | 🔓 | *(Nov 2026, primary)* Body `{ id_token }` from Google Sign-In. The API verifies Google's RS256 signature (Google's published keys), the audience (`GOOGLE_CLIENT_IDS`), issuer, expiry and that the email is Google-verified, then answers exactly like `/auth/otp/verify`. `401 INVALID_GOOGLE_TOKEN`; `503 GOOGLE_SIGNIN_UNAVAILABLE` until `GOOGLE_CLIENT_IDS` is set. |
| POST | `/auth/otp/verify` | 🔓 | Checks an **email or phone** code. Body `{ challenge_id, code }`. Existing member: `{ status: "signed_in", access_token, refresh_token, token_type, expires_in }`, plus `restored: true` when signing in cancelled a pending account deletion. New address or number: `{ status: "signup_required", signup_token, expires_in: 1800 }`. Under-18 and ban blocks apply to the email or phone **and** the device, whichever sign-in method is used. |
| POST | `/auth/refresh` | 🔓 | Body `{ refresh_token }`. Rotates the token. Replaying an already-rotated token returns `REFRESH_TOKEN_REUSED` and revokes every session in that family. |
| POST | `/auth/logout` | 🔑 | Revokes the current device session (takes effect immediately, and closes that device's chat socket). |
| GET | `/auth/sessions` | 🔑 | `{ sessions: [{ id, platform, device_model, created_at, last_used_at, current }] }`. |
| DELETE | `/auth/sessions/:id` | 🔑 | Signs one of your devices out: `204`, or `404` if it isn't an active session of yours. Its push token is dropped and its chat socket closes (`4401`). |
| DELETE | `/auth/sessions` | 🔑 | *(sprint 8)* "Sign out other devices": revokes every session except the current one. `{ revoked }`. |

**OTP limits** (SECURITY.md §2):
- **Codes:** 6 digits, 5-minute expiry, single use, at most 5 wrong attempts. The 5th wrong attempt locks the number for 15 minutes.
- **Resend cooldown:** 60 seconds, then 120 seconds.
- **Per phone and per device:** 3 codes per 10 minutes, 10 per day.
- **Per IP:** 30 per 10 minutes and 200 per day. This is deliberately high, because Nigerian carriers put many subscribers behind one CGNAT address.
- **Errors:** `OTP_RATE_LIMITED` and `OTP_LOCKED` include `details.retry_after` (seconds).

**Tokens:**
- **Access token:** an ES256 JWT that lasts 15 minutes and is bound to a device session, so revoking the session revokes the token.
- **Refresh token:** opaque, lasts 30 days, stored only as a SHA-256 hash.
- **Signup token:** an ES256 JWT that lasts 30 minutes. It can only be used on `/onboarding/*`.

## Onboarding

*Implemented in Stage 4, sprint 1.* Uses the **signup token** as the bearer token. No member record exists until `complete` succeeds.

| Method | Path | Gate | Description |
|---|---|---|---|
| POST | `/onboarding/age-gate` | Signup token | Body `{ date_of_birth: "YYYY-MM-DD" }`. Returns `204` if 18+. If under 18, returns `403 UNDERAGE` and blocks this phone and device for 12 months (later attempts get `SIGNUP_BLOCKED`). |
| POST | `/onboarding/complete` | Signup token | Body `{ first_name, date_of_birth, gender, interested_in[], intent }`. Creates the user, profile and preferences, then signs in: `201` with the token pair. Returns `409 PHONE_ALREADY_REGISTERED` if repeated. |

Age is 18+ only if it holds on both the Lagos and the UTC calendar date, so the API always agrees with the database CHECK constraint.

## Account & Profile

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/me` | 🔑 | `{ id, status, email, phone_last4 \| null, age, verification: { email, phone, age_verified, can_like_and_message, unlimited_chat }, capabilities: { like, text_chat, text_chat_daily_limit \| null, chat_photos, voice_calls, video_calls }, guidelines_accepted, profile, preferences }`. Never returns the full phone number or date of birth. `capabilities` is the source of truth for what the app offers: media and calls need a passed Smile ID check. |
| POST | `/me/guidelines/accept` | 🔑 | The community guidelines screen shown once after sign-up (18+ only, no nudity, no scams, keep chats in AMIVARA, be respectful). `204`, idempotent. |
| GET | `/me/preferences` | 🔑 | `{ interested_in[], age_min, age_max, max_distance_km }`. |
| PATCH | `/me/preferences` | 🔑 | Any of `interested_in` (1–3 of `woman`, `man`, `non_binary`, no repeats), `age_min` / `age_max` (whole years, 18–99), `max_distance_km` (1–300). The merged range must keep `age_min ≤ age_max` (`400 VALIDATION_FAILED`). Unknown fields are rejected. Returns the full preferences; discovery uses them on the next request. Interests and languages are profile fields: `PATCH /profiles/me`. |
| GET | `/profiles/:userId` | 🔑 | Another member's full profile: the discovery card shape (`first_name, age, verified, distance { km, label } \| null, intent, bio, prompts[], interests[], languages[], height_cm, job_title, education, photos[]`) plus `match_id` when you're matched. Distance is the same coarse, per-pair-jittered label as discovery, never coordinates. Visible only if neither of you has blocked the other, you haven't unmatched, and they're a verified member in good standing (a paused member stays visible to an active match only). Anything else is the same `404`. Unverified members can view, because browsing is open (PRD §5.3a). |

## Account controls & privacy

*Implemented in Stage 4, sprint 8.* Replaces the earlier `/me/pause`, `/me/data-export` and `DELETE /me` sketches.

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/users/me/settings` | 🔑 | `{ paused, incognito }`. |
| PATCH | `/users/me/settings` | 🔑 | Body `{ paused?, incognito? }` (at least one). Returns the new settings. **Pause:** status `paused`: hidden from discovery and can't be liked, while existing matches and chats carry on. A suspended or banned member can't pause or unpause (`403 ACCOUNT_SUSPENDED`). **Incognito:** shown in discovery only to people you've liked. PRD §5.6 makes it a Plus feature; until billing ships it needs a verified account (`403 VERIFICATION_REQUIRED`). |
| GET | `/users/me/export` | 🔑 | The NDPA access-right export, returned straight away as a JSON download (`Content-Disposition: attachment; filename="amivara-data-YYYY-MM-DD.json"`, `Cache-Control: no-store`). See below. |
| DELETE | `/users/me` | 🔑 | Deletes the account. `202 { purge_after }`. See below. |

**What the export contains** (`format: "amivara-export/1"`):
- **account:** phone, date of birth, status, created, phone and age verification times
- **profile:** every field, signed links to your photos (download them straight away; they expire), and the location on file. That is the latest point only, rounded to about 100 m. Other members never see it.
- **preferences**
- **verifications:** Smile ID results and timestamps only. We never hold ID images or the NIN.
- **likes sent, passes and blocks**
- **matches:** each one with the other member's first name, and **only the messages you sent**
- **reports you made**, **account actions** (warnings, suspensions) and **devices** (sessions)

Other people's data is kept to what's needed to make sense of yours.

**Deletion:** these happen immediately:
- Every session is revoked and every socket closed.
- Push tokens are dropped.
- The PostGIS location and its geohash are cleared, so you leave the spatial index.
- Status becomes `pending_deletion`, so you're out of discovery.
- Every active match is archived. Partners get `match.removed` and a silent list refresh.

**Signing in again within 30 days restores the account.** Archived matches stay archived, and you'll need to share your location again. A suspension that was running still applies. After 30 days the purge job (every `ACCOUNT_PURGE_SECONDS`, 3600 in deployed environments) deletes the photos from S3 and the user row. Every table cascades from it: profile, preferences, photos, sessions, likes, passes, blocks, matches, messages, verifications, reports and enforcement history. Backups age out within 35 days (SECURITY.md §4).

## Profiles

*Implemented in Stage 4, sprint 2.*

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/profiles/catalog` | 🔑 | The prompts, interest tags and languages members can choose from, plus all limits (`prompts: 5`, `photos: { min: 2, max: 6 }`, `height_cm: { min: 120, max: 230 }` and the rest). |
| GET | `/profiles/me` | 🔑 | Your editable profile: `first_name, gender, bio, intent, prompts[], interests[], languages[], height_cm, education, job_title, religion, city, photos[], has_location, completeness`. |
| PATCH | `/profiles/me` | 🔑 | Partial update of `bio` (≤ 500), `intent`, `prompts` (≤ 5, ids from the catalogue, answers ≤ 150, no repeats), `interests` (≤ 10), `languages` (≤ 8), `height_cm` (120–230), `education`, `job_title`, `religion`. `""` or `null` clears a text field. Unknown fields are rejected. Returns the profile. |
| PUT | `/profiles/me/location` | 🔑 | Body `{ lat, lng, accuracy_m? }`. Stored **rounded to ~100 m** as a PostGIS point and geohash, keeping only the latest. Returns `204`. The point is never returned by any endpoint. |

The database enforces the same limits with CHECK constraints: prompts ≤ 5, languages ≤ 8, interests ≤ 10, height 120–230 and a non-blank bio.

## Media

*Implemented in Stage 4, sprint 2.* Photos go **straight from the app to S3** with a presigned POST. The API never handles the file. Photos are never public: every response carries short-lived signed URLs (CloudFront in deployed environments).

| Method | Path | Gate | Description |
|---|---|---|---|
| POST | `/media/upload-url` | 🔑 | Body `{ content_type: "image/jpeg" \| "image/webp" }`. Reserves a photo and returns `{ photo_id, upload: { method: "POST", url, fields, file_field: "file" }, max_bytes: 1500000, expires_in: 600 }`. The S3 policy pins the key, the content type and the size. Returns `409 PHOTO_LIMIT` at 6 photos. |
| POST | `/media/photos/:id/confirm` | 🔑 | After the upload: checks that the object exists, its size, and that its **first bytes really are JPEG or WebP**. The photo then takes the next free slot. Errors: `409 UPLOAD_NOT_FOUND`, and `422 INVALID_IMAGE` (the file is also deleted). Returns `{ photos }`. |
| GET | `/media/photos` | 🔑 | `{ photos: [{ id, position, is_primary, url, moderation_status }] }`, in order. Position 0 is the main photo. |
| PUT | `/media/photos/order` | 🔑 | Body `{ photo_ids }`: must list every photo exactly once. The first becomes the main photo. |
| PUT | `/media/photos/:id/primary` | 🔑 | Makes this the main photo and keeps the others in order. |
| DELETE | `/media/photos/:id` | 🔑 | Removes the photo and its object. Returns `409 MIN_PHOTOS` if it would take you from 2 photos to 1. |

**Local development without S3:**
- **Setting.** With `MEDIA_LOCAL_DIR` set and no `S3_MEDIA_BUCKET`, photos are stored on disk. `MEDIA_LOCAL_BASE_URL` (e.g. `http://localhost:4000/v1` over adb reverse) is how the phone reaches the API.
- **Same flow.** The upload target becomes `POST /media/local/upload`, the same contract as the S3 presigned POST: fields, then `file`, `204`. It's guarded by a signed token that pins the key, the content type and the size.
- **Viewing.** Photos are served by `GET /media/local/file` with signed, expiring links.
- **Never deployed.** env.ts refuses `MEDIA_LOCAL_DIR` in staging and production.
- **No storage at all.** With neither setting, uploads answer `503 MEDIA_UNAVAILABLE`.

The app compresses every photo to **≤ 300 KB JPEG** before uploading (stepping quality and then size down), and strips EXIF data including GPS. Uploads that are never confirmed release their slot after 1 hour. New photos stay `moderation_status: pending` until automated moderation lands in a later sprint.

## Verification

*Implemented in Stage 4, sprint 3.* Smile ID Biometric KYC: the NIN is checked against NIMC, plus SmartSelfie™ liveness and a face match.

| Method | Path | Gate | Description |
|---|---|---|---|
| POST | `/verification/sessions` | 🔑 | Body `{ method: "biometric_kyc" }`. Returns `{ verification_id, environment, callback_url, partner_params: { user_id, job_id, job_type: 1 }, id_info: { country: "NG", id_type: "NIN_V2" }, partner_id, timestamp, signature, attempts_left }`. A new session supersedes any open one. Errors: `409 ALREADY_VERIFIED`, `409 UNDER_REVIEW`, `429 VERIFICATION_RATE_LIMITED` (5 per day), `503 VERIFICATION_UNAVAILABLE`. |
| GET | `/verification/status` | 🔑 | `{ phone, age_verified, latest: { verification_id, status: pending\|passed\|failed\|manual_review\|expired, reason, created_at } \| null, attempts_left }`. The app polls this while showing "Checking your details…". |
| POST | `/verification/webhook` | Smile ID signature | The Smile ID callback. It must carry `signature` = base64(HMAC-SHA256(api_key, timestamp + partner_id + "sid_request")) and a `timestamp` no more than 2 hours old; otherwise `401 INVALID_SIGNATURE`. Idempotent: only a pending verification can change, so retries return `{ status: "already_processed" }`. |

**Where the NIN goes:**
- The member types it in the app (on a screen that blocks screenshots), and the **Smile ID SDK sends it straight to Smile ID**.
- Our API never receives or stores it.
- The Smile ID API key never leaves the server. The app only has Smile ID's SDK auth token, supplied at build time.

**Decision** (`backend/src/modules/verification/decision.ts`, based on Smile ID's per-check `Actions`):

| Smile ID result | Outcome |
|---|---|
| ID verified, liveness passed, selfie matches the NIMC photo, DOB from NIMC matches the DOB declared at signup | **passed**: `users.age_verified = true`, liking and messaging unlocked |
| Identity confirmed but the DOB differs from the declared one, or no DOB was returned | **manual_review** |
| Identity confirmed and the NIMC DOB shows **under 18** | **failed (UNDERAGE)**: the account is **banned** and every session is revoked at once |
| Any check failed | **failed**, with up to 2 retries. The 3rd failure becomes **manual_review** |
| A check still pending (human review at Smile ID) | stays **pending** |

**Late or lost callbacks:** every `VERIFICATION_POLL_SECONDS` (120 in deployed environments), a poller asks Smile ID's `job_status` about sessions that have been pending for more than 2 minutes. Sessions with no result after 24 hours expire.

**Progressive trust (Nov 2026):** unverified members can browse, appear in discovery (without the gold badge), like, match and send **text** messages, capped at 10 a day across all chats (`403 VERIFICATION_REQUIRED` with `details: { reason: "unverified_chat_limit", limit: 10 }`). A passed Smile ID check lifts the cap and is required for chat photos (they only unlock between two verified members), voice and video calls (when built), and later the Plus purchase. Suspended and banned members get `403 ACCOUNT_SUSPENDED` on likes, matches and chat.

## Discovery & Matching

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/discovery?limit=10&cursor=` | 🔑 | *(sprint 4)* The ranked card stack: `{ cards: [{ user_id, first_name, age, verified, distance: { km, label }, intent, bio, prompts[{ prompt_id, prompt, answer }], interests, languages, height_cm, job_title, education, photos[{ id, url }] }], next_cursor, radius_km }`. Open to unverified members (browsing is free). Returns `409 LOCATION_REQUIRED` until a location is shared. |
| POST | `/matching/likes` | ✅ | *(sprint 4)* Body `{ user_id }`. Returns `201 { matched, match_id }`. A like in the other direction creates the match in the same transaction. Limit 50 per 24 hours (`429 DAILY_LIKE_LIMIT`). `is_super: true` returns `403 PLUS_REQUIRED`. |
| POST | `/matching/passes` | 🔑 | *(sprint 4)* Body `{ user_id }`. Returns `204`. Open before verification. The member is hidden from your stack for 30 days. |
| POST | `/matching/rewind` | ✅ Plus | Undo your last pass. |
| GET | `/matching/likes/received` | ✅ | Free members get a blurred count. Plus members get the full list. |
| GET | `/matches` | ✅ | *(sprint 5)* `{ matches: [{ match_id, matched_at, photos_unlocked, user: { user_id, first_name, age, verified, photo_url }, last_message: { snippet, from_me, sent_at } \| null, unread_count }] }`, newest conversation first. Matches with members since banned or deleted are hidden. |
| DELETE | `/matches/:id` | ✅ | *(sprint 5)* Unmatch. Returns `204`. **Final for both members:** the match and its conversation close, the pair never see each other in discovery again, and a later like never re-creates the match. Emits `match.unmatched`. Repeating it, or calling it as a non-participant, returns `404`. |

### How discovery works (sprint 4)

**Hard filters** (PRD §6). Every one must hold:
- both members are active and not deleted
- the candidate is **Smile ID-verified** (unverified members are never shown, PRD §5.3a) and visible in discovery
- each person's gender is in the other's "interested in"
- each person's age is in the other's age range
- the distance is within **both** members' radius (PostGIS `ST_DWithin` on the GiST index)
- no block in either direction
- not already liked, passed (for 30 days) or matched
- the candidate has at least one uploaded, non-rejected photo
- never yourself

**Ranking v1** (weights sum to 1):

| Weight | Signal |
|---|---|
| 0.40 | Distance: closer is better, linear across your radius |
| 0.30 | Recent activity: the later of the last API use (recorded at most every 15 minutes) and the last profile edit, decaying with a 72-hour time constant |
| 0.15 | Age fit: how centrally each person sits in the other's age range |
| 0.10 | Profile completeness |
| 0.05 | A small per-viewer, per-day shuffle, so the feed isn't static |

There is no scoring on ethnicity, religion or "desirability".

**Distance privacy** (SECURITY.md §4):
- Labels are bucketed: "Less than 2 km away", then whole km up to 10 km, then 5 km steps, then "50+ km away".
- A fixed ±15% jitter is applied per pair of members first, so repeating the query reveals nothing more.
- Coordinates and exact distances are never returned.

**Paging:** the cursor fixes "now" for the session, so scores stay stable from page to page. A cursor expires after 6 hours.

## Notifications

*Implemented in Stage 4, sprint 5.* Firebase Cloud Messaging (HTTP v1), sent directly from the API with a Google service-account token. No `firebase-admin` SDK is used.

| Method | Path | Gate | Description |
|---|---|---|---|
| POST | `/notifications/tokens` | 🔑 | Body `{ token, platform: "android" \| "web" }`. Returns `204`. Binds the FCM token to **this device session**. If another account registers the same token later, it moves to that account. |
| DELETE | `/notifications/tokens` | 🔑 | Body `{ token }`. Returns `204`. |

**Lifecycle:**
- Logging out, revoking a session, or a refresh-token reuse that ends the session family deletes that session's tokens.
- A refresh moves the tokens to the new session.
- Tokens FCM reports as unregistered are deleted.

**Pushes and their privacy** (a lock screen is visible to anyone near the phone):

| Event | Recipients | Visible notification | Data |
|---|---|---|---|
| `match.created` | both members | "It's a match ✦ / You have a new match on AMIVARA. Open the app to see who." **No names**, Android visibility `PRIVATE` | `{ type: "match.created", match_id }` |
| `match.unmatched` | the other member only | **none** (silent, data-only): no "X unmatched you" | `{ type: "match.removed", match_id }`. The app refreshes its list |

Push payloads never contain names, photos, phone numbers or any location. Push is off until `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` and `FCM_PRIVATE_KEY_PEM` are set (Terraform: the `fcm` secret plus `push_enabled = true`).

## Messaging

Chat lives inside a match. Every route needs a verified member (`403 VERIFICATION_REQUIRED`) and an **active** match: if you aren't in it, it was unmatched, or the other member was banned or suspended, the answer is `404 NOT_FOUND` (nothing to learn by probing).

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/matches/:id/messages?before=&limit=` | ✅ | History, newest first. `limit` 1–50 (default 30); pass the previous `next_before` as `before` for older pages. Returns `{ messages, next_before, photos, billing, host_tools }` (see "Hosts and paid messages"). |
| POST | `/matches/:id/messages` | ✅ | Send fallback when the socket is down. Body `{ body }`, 1–2,000 characters after trimming. `201` with the message plus `coins_charged`, `balance`, `free_remaining_today`. Delivered live to both members' sockets too. |
| POST | `/matches/:id/read` | ✅ | Body `{ up_to_message_id }`: marks the other member's messages up to that one as read. Returns `{ read }` and sends `message.read` to the sender. |

A message: `{ id, match_id, sender_id, type: "text", body, created_at, read_at }`.

**Rate limit:** 30 messages a minute per member, across all chats: `429 MESSAGE_RATE_LIMITED` with `details.retry_after`. Unverified members: 10 text messages a day (see "Progressive trust").

**Off-platform contact sharing:** every message is scanned for phone numbers (Nigerian 080/081/070/090/091, +234, international, digits split by spaces or dots, numbers spelled out), email addresses (including "at"/"dot" tricks), @handles and app names (WhatsApp, Instagram, Snapchat, Telegram, TikTok and similar). A match is still delivered, but it is logged in `safety_events` (member, match, message id and which signals fired; never the text), the REST response carries `safety_notice: "contact_sharing"`, and both members get a `safety.notice` event so the app can show a reminder to keep chatting in AMIVARA.

**Encryption at rest:** bodies are stored AES-256-GCM encrypted (`MESSAGE_ENC_KEY`, Terraform secret `message-key`, required in staging and production). The database and its backups never hold plaintext.

**Photo unlocking (PRD §5.5):** `photos` is `{ unlocked, threshold: 3, mine, theirs }` (counts capped at the threshold). Photos open in a chat once **both** members have sent 3 messages; the moment it happens both sockets get `photos.unlocked`, and `GET /matches` shows `photos_unlocked: true`. Sending photos in chat arrives in a later sprint.

**Pushes:** a new message pushes the recipient only when they have no open chat socket. The push is generic: title "AMIVARA", body "You have a new message." and data `{ type: "message.new", match_id }`. It never includes the sender's name or any of the message.

### WebSocket: `wss://api.amivara.com/ws/chat`

Connect with the same access token as REST, in the `Authorization: Bearer …` header. The device session must be active and the member verified. Otherwise the server closes the socket with **4401** (`UNAUTHENTICATED` / `INVALID_TOKEN`: refresh and reconnect) or **4403** (`VERIFICATION_REQUIRED` / `ACCOUNT_SUSPENDED`: don't retry). The server pings every 30 s and drops sockets that stop answering. Frames are JSON `{ event, data }`, at most 16 KB.

| Direction | Event | Payload |
|---|---|---|
| client → server | `message.send` | `{ match_id, body }` (same rules as the REST send) |
| client → server | `typing` | `{ match_id }`. Relayed, never stored. Clients send at most one every 3 s |
| client → server | `message.read` | `{ match_id, up_to_message_id }` |
| server → client | `message.new` | the message. Sent to **both** members, so the sender's other devices stay in sync (de-duplicate by `id`) |
| server → client | `message.read` | `{ match_id, up_to_message_id, read_at }` |
| server → client | `typing` | `{ match_id, user_id }`. Show "typing…" for about 4 s |
| server → client | `photos.unlocked` | `{ match_id }` |
| server → client | `match.removed` | `{ match_id }`. Sent to both members on unmatch: close the chat |
| server → client | `safety.notice` | `{ match_id, kind: "contact_sharing", role: "sender" \| "recipient", message_id }` |
| server → client | `error` | `{ code, message }`, the same codes as REST (including `VERIFICATION_REQUIRED` at the unverified daily cap). The socket stays open |

The socket registry is in-process for now (one API task). Running several tasks needs Redis pub/sub fan-out behind the same `RealtimeRegistry` interface.

## Wallet

*Milestone 1 of docs/MONETIZATION_PLAN.md.* Coins live in a double-entry ledger. The database refuses unbalanced transactions, member overdrafts and any edit to past entries. Members in good standing only (`403 ACCOUNT_SUSPENDED` otherwise).

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/wallet` | 🔑 | `{ balance, paid_coins, promo_coins, starter: { granted, coins }, first_purchase_eligible, payment_providers, packages: [{ id, coins, bonus_coins, first_purchase_bonus, total_coins, price_kobo, price_ngn, play_product_id, label }] }`. The first load after the community guidelines are accepted grants the **starter coins**. |
| GET | `/wallet/transactions?before=&limit=` | 🔑 | `{ transactions: [{ id, kind, coins, created_at, reason }], next_before }`, newest first. `coins` is the net change to the member's coins. |
| POST | `/wallet/topups` | 🔑 | Body `{ package_id, provider: "paystack" }`. `201 { id, reference, provider, status: "pending", coins, amount_kobo, price_ngn, checkout_url, … }`. Open `checkout_url` (Paystack's hosted page, in a Custom Tab). `503 PAYMENTS_UNAVAILABLE` when that provider isn't enabled or configured, `502 PAYMENT_PROVIDER_ERROR` when Paystack can't be reached, `429 TOPUP_RATE_LIMITED` after 10 unfinished checkouts in an hour. |
| GET | `/wallet/topups/:id` | 🔑 | `{ id, status: pending\|succeeded\|failed\|abandoned, coins, bonus_coins, total_coins, balance, paid_at, … }`. The app polls this while the member pays; a pending top-up is re-checked with Paystack (at most every 3 seconds). Owner only (404 otherwise). |
| POST | `/payments/paystack/webhook` | Public, signed | Paystack events. `x-paystack-signature` must be the HMAC-SHA512 of the raw body with the secret key (`401 INVALID_SIGNATURE` otherwise). `charge.success` / `charge.failed` for our `amv_` references prompt a verify-transaction call; the body itself is never trusted. Always `200 { received: true }` for authentic events. |
| GET | `/payments/paystack/return` | Public | The page Paystack returns the member to (`PAYSTACK_CALLBACK_URL`): "go back to AMIVARA". |

**Starter coins:** `STARTER_COINS` (100 by default) promo coins, granted once per member and once per device (HMAC of the device id in `promo_claims`), so new accounts on the same phone don't get more.

**Promo and paid coins:**
- Promo coins (starter grants, goodwill credits) and bought coins are separate balances. Spending uses promo coins first.
- Only the bought part of a spend can become Host earnings (milestone 3), so free coins can't be farmed into cash.
- A spend the balance can't cover answers `402 INSUFFICIENT_COINS` with `details: { balance, required }`. The app opens the top-up sheet in place.

**Packages (final, 15 Nov 2026):** 500 coins for ₦1,000 (+100 on a first purchase), 2,000 for ₦3,500 (+400, labelled "Most popular"), 10,000 for ₦15,000 (+2,000) and 30,000 for ₦40,000 (+7,500). Packages also carry an optional `label`.

**Top-ups (milestone 2):**
- **Checkout.** `payment_providers` lists the checkouts the API accepts now (`PAYMENT_PROVIDERS` and configured). Each app build uses one (`--dart-define=PAYMENT_PROVIDER`, default `paystack`). Google Play Billing sits behind the same interface and answers `503` until it's wired.
- **Crediting.** Coins are credited only after Paystack's verify-transaction API confirms the payment, for exactly the package's amount in NGN. A different amount is held as `failed` (`amount_mismatch`) for staff. Webhook, app poll and the reconciler can race: the intent row lock and the ledger key `topup:paystack:<reference>` credit it exactly once.
- **Bonus coins.** Bought coins are credited as paid coins. The package bonus and the first-purchase bonus (given on the member's first successful top-up only) are credited as **promo** coins, so they never become Host earnings.
- **Reconciliation.** Every `PAYMENT_RECONCILE_SECONDS` (600 when deployed), unfinished top-ups older than 2 minutes are re-checked. One still unpaid after 24 hours becomes `abandoned`; a late payment still credits.
- **Data shared with Paystack.** The amount, our reference, ids in `metadata`, and a receipt email: the member's verified email, or a pseudonymous `m-…@members.amivara.com` address. No names, phone numbers or profile data. Card and bank details are entered on Paystack's page and never reach AMIVARA.

## Hosts and paid messages

*Milestone 3 of docs/MONETIZATION_PLAN.md.* Any NIN-verified member can opt in as a **Verified Host**; there is no gender rule.

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/me/host` | 🔑 | `{ host: null \| { status: active\|paused, revenue_share_bps, earning_since, hold_days } }` |
| POST | `/me/host` | 🔑 verified | Opt in, or resume after pausing. `403 VERIFICATION_REQUIRED` without a passed Smile ID check. |
| POST | `/me/host/pause` | 🔑 | Messages to them become free and nothing new is earned. Held earnings stay theirs. |
| GET | `/me/host/earnings` | 🔑 | `{ pending_coins, available_coins, hold_days, recent: [{ id, coins, created_at, available_at, released }] }` |
| GET | `/matches/:id/icebreakers` | 🔑 Host | `{ icebreakers: [{ text }] }`: 3–5 starters built from the other member's public profile (shared interests first, their interests, a prompt they answered, their city). Stable for the day. `403 HOST_ONLY`, `429 ICEBREAKER_RATE_LIMITED` (60 an hour). |

**Paid messages:**
- **Price.** Messaging an active Host is free for `FREE_HOST_MESSAGES_PER_DAY` (3) messages per conversation per Lagos day. After that each message costs `MESSAGE_PRICE_COINS` (10) coins. Both values were confirmed on 16 Nov 2026.
- **Who pays.** The Host's own replies are free. Conversations between members who aren't Hosts are never billed.
- **Charging.** The charge happens in the same transaction as the message, so a `402 INSUFFICIENT_COINS` (`details: { balance, required }`) stores nothing. A member's concurrent sends are serialised, so two at once can't both use the last free message.
- **Responses.** `POST /matches/:id/messages` returns `coins_charged`, `balance` and `free_remaining_today`. Over `/ws/chat`, the sender gets a `wallet.updated` event with the same fields.
- **Chat history.** History includes `billing: { paid, price_coins, free_per_day, free_remaining_today }` and `host_tools` (the viewer is an active Host, so the app shows the icebreaker bar).

**Earnings:**
- **Split.** Spending uses promo coins first. The Host earns `revenue_share_bps` (default 5000 = 50%, confirmed 16 Nov 2026) of the **bought** coins only, rounded down. The rest goes to platform revenue. Promo coins never become earnings.
- **Hold.** Earnings sit in `MEMBER_EARNINGS_PENDING` for `HOST_EARNINGS_HOLD_DAYS` (7). The release job (`HOST_RELEASE_SECONDS`, hourly when deployed) then moves them to `MEMBER_EARNINGS_AVAILABLE`. Withdrawals arrive in M7.

## AI Companions

*Milestone 3b of docs/MONETIZATION_PLAN.md (section 3e).* Clearly labelled AI personas in their own section. They are **not** members: they never appear in discovery, likes or matches, never carry the gold verified badge, and can never earn.

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/ai/companions` | 🔑 | `{ available, companions: [{ id, slug, name, tagline, bio, interests, is_ai_companion: true, label: "AI Companion" }] }`. `available` is false without an LLM key. |
| POST | `/ai/companions/:slug/conversation` | 🔑 | Opens (or reopens) the member's chat. A new chat starts with the persona's fixed greeting, which always says it's an AI. The model is never called here: companions never write first. |
| GET | `/ai/conversations` · `/ai/conversations/:id` | 🔑 | The member's AI chats; one chat with its last 50 messages (`role: member\|companion`, `ai`, `body`, `coins_charged`, `refunded`) and `billing`. |
| POST | `/ai/conversations/:id/messages` | 🔑 | Body `{ body }` (1–1,000 characters). `201 { message, reply, coins_charged, balance, billing }`. |
| DELETE | `/ai/conversations/:id` | 🔑 | Deletes the chat and its messages. |
| POST | `/ai/messages/:id/report` | 🔑 | Flags a companion reply for review. |
| GET / PUT | `/me/spend-limits` | 🔑 | `{ ai_daily_cap_coins, effective_ai_daily_cap_coins, ai_spent_today, self_excluded_until }`. PUT `{ ai_daily_cap_coins: number \| null }`. |
| POST | `/me/spend-limits/self-exclude` | 🔑 | Body `{ days: 7 \| 30 }`. A break from AI chats. It can be extended, never shortened. |

**Billing:**
- **Price.** 3 free messages per chat per Lagos day (`FREE_AI_MESSAGES_PER_DAY`), then 10 coins each (`AI_MESSAGE_PRICE_COINS`).
- **Revenue.** 100% goes to platform revenue: no Host, no earnings entries.
- **Failed replies.** If the model fails, the coins are refunded (a `REFUND` transaction) and the API answers `503 AI_UNAVAILABLE`.

**Wellbeing:**
- **Caps.** The member can set a daily cap. In their first 7 days a soft cap of 200 coins a day applies (`AI_NEW_MEMBER_DAILY_CAP`); the lower of the two wins.
- **Limit errors.** Over the cap: `403 SPEND_LIMIT_REACHED` with `details: { cap, spent_today }`. During a break: `403 SELF_EXCLUDED` with `details: { until }`.

**Model and data:**
- **Provider.** The model sits behind an `LlmClient` interface (`LLM_PROVIDER=openai`, `OPENAI_MODEL=gpt-4o-mini`, `OPENAI_API_KEY`), with `store: false`.
- **What's sent.** Only the persona, the server's safety rules and the chat's last 20 messages go to the model: no member id, name, profile or location.
- **Rules.** The server's rules forbid:
  - claiming to be human
  - mentioning coins or spending, or pushing the member to stay
  - asking for personal data, contact details, money or gifts
  - sexual content
- **Distress.** The rules point members in distress to someone they trust and to 112.
- **Output filter.** It replaces any reply that claims to be human, mentions coins or top-ups, suggests meeting, or contains contact details.
- **Storage.** Bodies are encrypted at rest and deleted with the chat or the account.

## Calls

*Milestones 4 and 5 of docs/MONETIZATION_PLAN.md.* 1-on-1 voice and video calls between matched members, with LiveKit carrying the audio and video (`CALLS_PROVIDER=livekit`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). The API owns ringing, answering and billing; the media server never decides who may call or what it costs.

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/matches/:id/calls/quote` | 🔑 | `{ available, allowed, paid, voice_rate_per_minute, video_rate_per_minute }`. `allowed` needs both members NIN-verified (`capabilities.voice_calls` / `video_calls`). The chat header shows the call buttons only when `available && allowed`. |
| POST | `/matches/:id/calls` | 🔑 | Body `{ type: "voice" \| "video" }`. Rings the other member: `201 { call }`. |
| GET | `/calls/current` | 🔑 | The member's live call (`{ call, other: { id, first_name } }` or `{ call: null }`), e.g. after an incoming-call push. |
| GET | `/calls/:id` | 🔑 | One call (either member). |
| POST | `/calls/:id/accept` | 🔑 | Callee only, while ringing. Charges the first minute of a paid call. `{ call, media: { url, token } }`. |
| POST | `/calls/:id/join` | 🔑 | Either member of an active call: a fresh join token (the caller calls it on `call:accept`, and on reconnects). `{ call, media, balance }`. |
| POST | `/calls/:id/decline` | 🔑 | Callee, while ringing. |
| POST | `/calls/:id/end` | 🔑 | Hang up or cancel (either member). Idempotent. |
| POST | `/calls/livekit/webhook` | Signed | LiveKit webhook (`Authorization` signed with the API secret). A member leaving the room ends the call. |

**Call object:** `{ id, match_id, type, status, role: caller|callee, other_user_id, rate_per_minute, paid, ring_expires_at, started_at, ended_at, billed_minutes, total_coins_billed (caller only), end_reason }`. `status` is `ringing`, `active`, `ended`, `declined`, `missed`, `cancelled` or `insufficient_coins`.

**Signalling over `/ws/chat`** (server → client): `call:ring { call, caller: { id, first_name } }`, `call:accept { call }`, `call:decline { call }`, `call:end { call, top_up? }`, `call:billed { call_id, billed_minutes, total_coins_billed, rate_per_minute, balance }` (caller only) and `call:low_balance { call_id, balance, required, seconds_left }` (caller only). The app keeps one socket open app-wide, so calls ring on any screen.

**Rules:**
- **Who.** Matched members only, both NIN-verified. Unverified callers get `403 VERIFICATION_REQUIRED`; an unverified callee gives `403 FORBIDDEN` (`details.reason: callee_unverified`).
- **One call at a time.** A member already ringing or in a call gives `409 CALLEE_BUSY` (`details.reason: callee_busy | you_are_in_a_call`). Redialling replaces the caller's own unanswered call.
- **Ring timeout.** Unanswered calls are `missed` after 45 seconds (`CALL_RING_TIMEOUT_SECONDS`).
- **Rate limit.** 10 call attempts per caller per 10 minutes (`429 CALL_RATE_LIMITED`).
- **Ends.** Unmatching, blocking, a suspension or ban, or deleting the account ends live calls at once. So does a member leaving the LiveKit room (webhook), or their app staying offline for 30 seconds.
- **Not configured.** Without LiveKit settings, `503 CALLS_UNAVAILABLE`.

**Billing (calls to an active Verified Host; other calls are free):**
- **Rates.** 30 coins per started minute for voice (`CALL_VOICE_RATE_COINS`), 60 for video (`CALL_VIDEO_RATE_COINS`), paid by the caller. The rate is fixed when the call starts.
- **Before ringing.** The caller needs one minute's coins, or `402 INSUFFICIENT_COINS` with `details: { balance, required }` (the app opens the top-up sheet).
- **Charging.** The first minute is charged on answer, then one minute every 60 seconds by the server's ticker (`CALL_TICK_MS`; rows locked with `SKIP LOCKED`, idempotent per call and minute). The phone never decides what's charged.
- **Low balance.** After a charge that leaves less than one minute, the caller gets `call:low_balance` and can top up in the call.
- **Cut-off.** If the next minute can't be paid, the call ends with status `insufficient_coins`, and the caller's `call:end` carries `top_up: { balance, required }`. If the caller can't pay the first minute when the Host answers, accept answers `409 CALL_NOT_RINGING` (`details.reason: insufficient_coins`).
- **Earnings.** The Host earns their share (50%) of the bought-coin part of each minute, held 7 days, as with paid messages. Promo coins never become earnings.

**Privacy:** join tokens last 10 minutes and allow one room; voice tokens can publish the microphone only. Incoming-call and missed-call pushes are generic ("Incoming call. Open AMIVARA to answer.") and never name the caller.

## Gifts

*MONETIZATION_PLAN.md 3b.* Virtual gifts for active Verified Hosts, in a chat or a Chat House room. The catalogue lives in the `gifts` table, so prices change without a release. Prices (locked 17 Nov 2026): Rose 🌹 20, Kiss 💋 50, Teddy 🧸 200, Crown 👑 1,000 coins.

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/gifts` | 🔑 | `{ gifts: [{ id, slug, name, emoji, price_coins }] }`, cheapest first. |
| POST | `/matches/:id/gifts` | 🔑 | Body `{ gift_id, idempotency_key }`. `201 { message, coins_charged, balance }`. The gift is a `type: "gift"` message (`gift: { slug, name, emoji }`) both members see, over `message.new` too. |

**Rules:**
- **Who.** Only active Verified Hosts receive gifts; anyone else gives `403 HOST_ONLY`.
- **Paying.** Promo coins first; `402 INSUFFICIENT_COINS` stores nothing. The app sends a fresh `idempotency_key` per tap, so a retry never charges twice.
- **Earnings.** The Host earns their share (50%) of the bought-coin part, held 7 days. Promo coins never become earnings.
- **Limits.** 20 gifts per sender per minute (`429 GIFT_RATE_LIMITED`). A gift's price is never shown to the recipient.

## Chat House rooms

*MONETIZATION_PLAN.md 3b.* Live rooms run by Verified Hosts on the same LiveKit setup as calls (room `house_<id>`, up to 500 people). Live only: nothing is recorded.

| Method | Path | Gate | Description |
|---|---|---|---|
| POST / DELETE | `/hosts/:id/follow` | 🔑 | Follow or unfollow a Host. |
| GET | `/rooms` | 🔑 | Live rooms this member may join: open rooms, and followers-only rooms of Hosts they follow. Rooms of blocked members and rooms they're banned from are hidden. |
| POST | `/rooms` | 🔑 Host | Body `{ title, mode: audio\|video, audience: open\|followers, seats? (0–8) }`. Goes live: `201 { room, media }`. One live room per Host (`409 ROOM_ALREADY_LIVE`). |
| GET | `/rooms/:id` | 🔑 | The room: `host`, `speakers [{ id, first_name, role, muted_by_host }]`, `listeners` (a count), `me { id, role, seat_requested, muted_by_host, following }`; `seat_requests` for the Host only. |
| POST | `/rooms/:id/join` | 🔑 | Joins as a listener (or rejoins after a drop): `{ room, media }`. Listener tokens can't publish. Followers-only rooms: `403 FOLLOWERS_ONLY`. Ended: `410 ROOM_ENDED`. |
| POST | `/rooms/:id/leave` · `/rooms/:id/end` | 🔑 | Leave; the Host leaving or ending closes the room for everyone (`room:ended`). |
| POST / DELETE | `/rooms/:id/seat-request` | 🔑 verified | Ask for (or withdraw) a speaker seat. Unverified: `403 VERIFICATION_REQUIRED`. |
| POST | `/rooms/:id/speakers/:userId` | 🔑 Host | Seats someone who asked. `409 NO_SEAT_REQUEST`, `409 ROOM_SEATS_FULL`. |
| POST | `/rooms/:id/speakers/:userId/remove` | 🔑 Host or self | Back to the audience. |
| POST | `/rooms/:id/mute/:userId` · `/unmute/:userId` | 🔑 Host | Takes away (or gives back) a speaker's right to publish. |
| POST | `/rooms/:id/ban/:userId` | 🔑 Host | Removes them now (`room:removed`) and for the rest of this room. |
| GET / POST | `/rooms/:id/messages` | 🔑 in room | Room chat (last 50; body 1–500 characters, 10 a minute). |
| POST | `/rooms/:id/gifts` | 🔑 in room | Body `{ gift_id, recipient_id?, idempotency_key }`: to the Host (default) or a seated speaker who is an active Host. Everyone sees `room:gift`. |
| POST | `/rooms/:id/report` | 🔑 | The visible report button. Body `{ category, details?, user_id? }` (default: the Host). The evidence includes the room and the reported member's latest room messages. Reporting blocks, as everywhere. |

**Realtime (over `/ws/chat`):** `room:updated { room }` (to everyone in the room, after any seat, mute or join change), `room:message`, `room:gift`, `room:seat_request` (Host only), `room:removed`, `room:ended { room_id, reason }`.

**Safety:**
- **Speakers.** Only NIN-verified members can speak; anyone can listen. Seats are LiveKit publish permissions the API grants and revokes; a muted speaker's reconnect doesn't restore them.
- **Contact details.** Room messages with phone numbers, WhatsApp, handles and the like are held back (`422 CONTACT_SHARING_BLOCKED`) and logged for Safety (`ROOM_CONTACT_SHARING`).
- **Closing.** A room ends when its Host ends it, leaves, drops out of LiveKit (webhook), stays offline for 30 seconds, or is suspended. Room chat is encrypted at rest.

## Host payouts

*Milestones 7/8 of docs/MONETIZATION_PLAN.md.* Verified Hosts withdraw available earnings to a Nigerian bank account (OPay and other wallets with a NUBAN included) through Paystack Transfers, behind a `PayoutProvider` interface.

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/hosts/banks` | 🔑 | `{ banks: [{ code, name }] }` (Paystack's Nigerian bank list, cached for a day). |
| POST | `/hosts/bank-account/resolve` | 🔑 active Host | Body `{ bank_code, account_number }` (10 digits). The holder's name, without saving: `{ bank_code, bank_name, account_name, account_last4 }`. Unknown account: `422 ACCOUNT_NOT_RESOLVED`. 10 look-ups an hour (`429 RESOLVE_RATE_LIMITED`). |
| POST | `/hosts/bank-account` | 🔑 active Host | Same body. Resolves again on the server, creates the Paystack transfer recipient and saves the account: `{ account: { bank_code, bank_name, account_last4, account_name } }`. Not while a payout is in flight (`409 PAYOUT_IN_PROGRESS`). |
| GET | `/hosts/bank-account` | 🔑 Host | `{ account }` or `{ account: null }`. |
| GET | `/hosts/payouts` | 🔑 Host | Releases matured earnings, then `{ pending_coins, pending_kobo, available_coins, available_kobo, kobo_per_coin, min_withdraw_coins, min_withdraw_kobo, payouts_enabled, account, payouts: [...] }`. |
| POST | `/hosts/withdraw` | 🔑 Host | Body `{ coins? }` (default: everything available). `201 { payout: { id, coins, amount_kobo, status, bank_name, account_last4, account_name, failure_reason, created_at, completed_at } }`. |

**Rules:**
- **Who.** NIN-verified members with a Host profile whose account is in good standing. Linking a bank account needs active Host mode; paused Hosts can still withdraw what they earned. Suspended or banned members' earnings are frozen.
- **Value.** `PAYOUT_KOBO_PER_COIN` (default 100: ₦1 a coin; coins sell for ₦1.07–₦2). Minimum withdrawal `PAYOUT_MIN_NAIRA` (default ₦5,000 = 5,000 coins): `422 BELOW_MINIMUM_WITHDRAWAL`. More than available: `422 INSUFFICIENT_EARNINGS`.
- **Maturing.** Earnings are held 7 days (`HOST_EARNINGS_HOLD_DAYS`), then move to available: hourly in deployed environments, and on demand before any balance is shown or withdrawn.
- **Once only.** The withdrawal moves the coins from available earnings to `PAYOUT_CLEARING` in the same database transaction that records the payout, under a lock; the database allows one `pending` payout per Host (`409 PAYOUT_IN_PROGRESS`). The Paystack transfer uses the payout's unique reference (`amvpo_…`).
- **Outcomes.** `success` settles the coins (clearing → `PLATFORM_PAYOUTS`). `failed` (or Paystack refusing the transfer outright) returns them to available earnings at once. `reversed` after a success returns them too. Timeouts stay `pending` until the webhook or the reconciler (`PAYOUT_RECONCILE_SECONDS`, 600 deployed) checks with Paystack.
- **Webhooks.** `transfer.success`, `transfer.failed` and `transfer.reversed` arrive at `/payments/paystack/webhook` (signed); each is re-checked with Paystack's verify-transfer before anything changes, and replays change nothing.
- **Safety switch.** `PAYOUTS_ENABLED` (default `false`, Terraform `payouts_enabled`): withdrawals answer `503 PAYOUTS_DISABLED` until it's on. Paystack transfers also need "OTP for transfers" turned off and a funded Paystack balance.
- **Privacy.** The account number is encrypted at rest; the app only ever sees the last 4 digits. The resolved account name is shown to the Host to confirm (it's not matched against the NIN name, which we don't store).

## Lower-friction onboarding (17 Nov 2026)

**Consent.** The welcome screen has a required checkbox: "I confirm I am 18+ and agree to AMIVARA's Terms of Service & Privacy Policy" (both open in the app; the text is a plain-language draft for legal review). Sign-in stays off until it's ticked, and `POST /onboarding/complete` needs `accepted_terms: true` (else `400 VALIDATION_FAILED`); the API records `users.accepted_terms_at`. `GET /me` reports `terms_accepted`.

**Asymmetric verification.**
- Without NIN verification, members can browse, buy coins, chat and call with Verified Hosts (`capabilities.host_chat`, `host_calls`), send gifts and listen in Chat House rooms. The unverified daily message cap applies only to member-to-member chats.
- NIN (Smile ID) stays required for: becoming a Verified Host (earning, payouts), member-to-member calls (`capabilities.voice_calls` / `video_calls`, both members verified), and speaking on a Chat House stage.

**Direct chat with Verified Hosts.**

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/hosts/online` | 🔑 | `{ hosts: [{ user_id, first_name, age, city, photo_url, online, voice_rate_per_minute, video_rate_per_minute }] }`: active Verified Hosts with the app open (blocks hidden). |
| POST | `/hosts/:id/chat` | 🔑 | Opens (or returns) the conversation with that Host: `{ match_id }`. A `HOST_DIRECT` match: no mutual like, no "It's a match" push; messaging, gifts and calls work as in any match. Not a Host, blocked, or unmatched before: `404`. Matches list items carry `direct: true`. Mutual matching stays for member-to-member. |

**Calls with Hosts.**
- **Who pays.** The member who isn't the Host (both Hosts: the caller). Calls show `you_pay`, and only the payer sees `total_coins_billed`; `call:billed`, `call:low_balance` and the cut-off `top_up` go to the payer.
- **Free preview.** A member's first paid call starts with `CALL_FREE_PREVIEW_SECONDS` (15) free: it can be placed with 0 coins, the first minute is charged when the preview ends, and if it can't be paid the call ends `insufficient_coins` with a top-up. Once per member and once per device (so new accounts can't farm it); a call that's never answered gives the preview back. Calls show `preview_seconds`; the quote shows `free_preview_seconds` and `you_pay`.
- **Ringtone.** Incoming calls loop `assets/sounds/amivara_ringtone.mp3` (an original chime made by `scripts/sounds/make_ringtone.py`) on Android's ringtone stream until answered, declined or timed out.

**Quick Connect.**

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/hosts/newcomers` | 🔑 active Host | Online members who joined in the last `NEWCOMER_DAYS` (7), accepted the guidelines and accept live call invites: `{ newcomers: [{ user_id, first_name, age, city, photo_url, online, invited_today }] }`. |
| POST | `/hosts/newcomers/:id/call` | 🔑 active Host | Body `{ type }`. Rings the newcomer (`invite: true`); they pay after their free preview and see the price before answering. Answering without coins or preview: `402 INSUFFICIENT_COINS` (top-up). Limits (`429 INVITE_RATE_LIMITED`): one invite per Host and member a day, 3 invites a day per member, 20 an hour per Host. Invites off: `403 INVITES_OFF`. |
| PUT | `/me/call-invites` | 🔑 | Body `{ enabled }`. "Receive live call invites" (on by default; Settings). `GET /me` reports `call_invites_enabled`. |

## Safety

Open to every signed-in member, verified or not: anyone must be able to block and report.

| Method | Path | Gate | Description |
|---|---|---|---|
| POST | `/safety/blocks` | 🔑 | Body `{ user_id }`. `204`, idempotent. Hides both members from each other everywhere (discovery both ways, likes). Any active match between them is archived (unmatched): open chats get `match.removed` on both sides and the other member's list refreshes silently. |
| DELETE | `/safety/blocks/:userId` | 🔑 | Unblock. `204`, or `404` if there was no block. A match never comes back. |
| GET | `/safety/blocks` | 🔑 | `{ blocks: [{ user_id, first_name, blocked_at }] }`, newest first. |
| POST | `/safety/reports` | 🔑 | Body `{ user_id, category, details?, message_id? }`. `201 { report_id, priority }`. Reporting **also blocks** the person. |

**Report categories (PRD §5.6):** `fake_profile`, `underage`, `harassment`, `scam`, `explicit_content`, `hate`, `other`. Priority: `underage` is `critical` (target: resolved within an hour, 24/7), and it **suspends the reported account at once** until a moderator reviews it. `harassment`, `scam`, `explicit_content` and `hate` are `high`; `fake_profile` and `other` are `normal`. `details` is up to 1,000 characters. `message_id` must be a message in the reporter's chat with that person.

**Evidence:** each report stores a snapshot taken when it was filed: the reported profile (name, age, bio, prompts, job, photo keys, verified, member since) and the last 50 messages between them. The snapshot is encrypted like messages (`MESSAGE_ENC_KEY`), and the database refuses to change it (trigger), so moderators see what the reporter saw, even if messages are deleted later.

**Limit:** 20 reports per member per 24 hours (`429 REPORT_RATE_LIMITED`).

## Admin

The moderation API for the console (`apps/admin`). Staff roles only (`moderator`, `senior_moderator`, `admin`); for anyone else every admin route is a `404`. Every action, and every opening of a report's evidence, is written to the append-only `audit_log` (UPDATE and DELETE are refused in SQL). Staff accounts can't be actioned here, and nobody can action themselves (`403 FORBIDDEN`).

| Method | Path | Description |
|---|---|---|
| GET | `/admin/me` | `{ id, role, first_name }`. The console's staff check. |
| GET | `/admin/reports?status=open\|actioned\|dismissed&limit=` | The queue. Open reports are ordered critical first, then oldest first. `{ counts: { critical, high, normal }, reports: [...] }`, each with the reporter, and the reported member's name, age, status, verified, first photo and number of open reports. |
| GET | `/admin/reports/:id` | One report: the evidence snapshot (messages marked `reporter` / `reported`, the reported `message_id`), the live profile with signed photo URLs, the member's enforcement history and other reports about them. Audited as `report.view`. |
| POST | `/admin/reports/:id/dismiss` | Body `{ note? }`. `204`; `409` if it's already resolved. |
| POST | `/admin/users/:id/warn` | Body `{ reason, report_id? }`. Records a warning and sends the member a generic push ("A note from AMIVARA Safety"). Nothing about the report or the reporter. |
| POST | `/admin/users/:id/suspend` | Body `{ reason, days (1–90), report_id? }`. Status `suspended` until then: gated actions return `403 ACCOUNT_SUSPENDED`, the member is hidden from discovery and chats, and open sockets close with `4403`. The suspension lifts itself on the first request after it ends. |
| POST | `/admin/users/:id/ban` | Body `{ reason, report_id? }`. Permanent: every device session revoked (sign-in and refresh return `403 ACCOUNT_SUSPENDED`), push tokens dropped, sockets closed, and the phone number and every device the member signed in on are added to the signup blacklist (`SIGNUP_BLOCKED`; HMACs only, no raw numbers or device ids). All open reports about them are closed. |
| POST | `/admin/users/:id/coins` | Body `{ coins` (non-zero, ±1,000,000), `wallet: "promo" \| "paid", reason, idempotency_key }`. Credits or debits a member's coins, e.g. goodwill after a failed call. Idempotent per key, audited as `wallet.adjust`; a debit beyond the balance is `402 INSUFFICIENT_COINS`. |
| POST | `/admin/users/:id/unban` | Body `{ reason }`. Lifts a ban or suspension and its blacklist entries. `409` if the member isn't banned or suspended. |

`reason` is 3–1,000 characters and goes into the member's enforcement history (`enforcement_actions`) and the audit log. When `report_id` is given it must be an open report about that member, and it's resolved as `actioned`.

**Console sign-in:** moderators sign in to the console with the same phone OTP as the app, and the console then checks `/admin/me`. Tokens stay in httpOnly, Secure, SameSite=Strict cookies, and the console calls the API from its server only. SECURITY.md §3 still requires SSO with MFA plus the IP allowlist / VPN in front of the console before launch.

## Error codes

Every error has the shape `{ "error": { "code", "message", "details"? } }`. Clients switch on `code`.

- **Auth:** `UNAUTHENTICATED`, `INVALID_TOKEN`, `INVALID_PHONE`, `OTP_INVALID` (`details.attempts_left`), `OTP_EXPIRED`, `OTP_LOCKED`, `OTP_RATE_LIMITED`, `OTP_DELIVERY_FAILED`, `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_REUSED`, `ACCOUNT_SUSPENDED`
- **Onboarding:** `UNDERAGE`, `SIGNUP_BLOCKED`, `PHONE_ALREADY_REGISTERED`, `EMAIL_ALREADY_REGISTERED`
- **Email and Google sign-in:** `INVALID_EMAIL`, `INVALID_GOOGLE_TOKEN`, `GOOGLE_SIGNIN_UNAVAILABLE`, `PHONE_SIGNIN_UNAVAILABLE` (production without an SMS provider)
- **Discovery and matching:** `LOCATION_REQUIRED`, `DAILY_LIKE_LIMIT`, `PLUS_REQUIRED`
- **Media:** `PHOTO_LIMIT`, `MIN_PHOTOS`, `UPLOAD_NOT_FOUND`, `INVALID_IMAGE`, `MEDIA_UNAVAILABLE`
- **Gifts and rooms:** `HOST_ONLY`, `GIFT_RATE_LIMITED`, `ROOM_ALREADY_LIVE`, `ROOM_ENDED` (410), `ROOM_SEATS_FULL`, `NO_SEAT_REQUEST`, `FOLLOWERS_ONLY`, `CONTACT_SHARING_BLOCKED`
- **Payouts:** `PAYOUTS_UNAVAILABLE`, `PAYOUTS_DISABLED`, `ACCOUNT_NOT_RESOLVED`, `RESOLVE_RATE_LIMITED`, `NO_PAYOUT_ACCOUNT`, `PAYOUT_IN_PROGRESS`, `BELOW_MINIMUM_WITHDRAWAL`, `INSUFFICIENT_EARNINGS`
- **Quick Connect:** `INVITE_RATE_LIMITED`, `INVITES_OFF`
- **Calls:** `CALLS_UNAVAILABLE`, `CALLEE_BUSY`, `CALL_NOT_RINGING`, `CALL_RATE_LIMITED`, plus `INSUFFICIENT_COINS` and `VERIFICATION_REQUIRED`
- **General:** `VALIDATION_FAILED` (`details.fields[]`), `NOT_FOUND`, `FORBIDDEN`, `NOT_IMPLEMENTED`, `INTERNAL`
- **Messaging and safety:** `MESSAGE_RATE_LIMITED`, `REPORT_RATE_LIMITED`
- **Wallet:** `INSUFFICIENT_COINS` (402, also sent over `/ws/chat` as an `error` event with `details`), `PAYMENTS_UNAVAILABLE` (503), `PAYMENT_PROVIDER_ERROR` (502), `TOPUP_RATE_LIMITED` (429)
- **Verification:** `VERIFICATION_REQUIRED` (403 on likes, messages and other gated routes), `VERIFICATION_UNAVAILABLE`, `ALREADY_VERIFIED`, `UNDER_REVIEW`, `INVALID_SIGNATURE`
- **Later sprints:** `NOT_MATCHED`, `PHOTOS_LOCKED`
