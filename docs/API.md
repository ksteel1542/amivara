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
| POST | `/auth/otp/verify` | 🔓 | Body `{ challenge_id, code }`. Existing member: `{ status: "signed_in", access_token, refresh_token, token_type, expires_in }`, plus `restored: true` when signing in cancelled a pending account deletion. New number: `{ status: "signup_required", signup_token, expires_in: 1800 }`. |
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
| GET | `/me` | 🔑 | *(sprint 1)* `{ id, status, phone_last4, age, verification: { phone, age_verified, can_like_and_message }, profile, preferences }`. Never returns the full phone number or date of birth. |
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

**Gate:** liking, Super Liking, rewind, conversations and messages (and later the Plus purchase) return `403 VERIFICATION_REQUIRED` until the member passes.

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
| GET | `/matches/:id/messages?before=&limit=` | ✅ | History, newest first. `limit` 1–50 (default 30); pass the previous `next_before` as `before` for older pages. Returns `{ messages, next_before, photos }`. |
| POST | `/matches/:id/messages` | ✅ | Send fallback when the socket is down. Body `{ body }`, 1–2,000 characters after trimming. `201` with the message. Delivered live to both members' sockets too. |
| POST | `/matches/:id/read` | ✅ | Body `{ up_to_message_id }`: marks the other member's messages up to that one as read. Returns `{ read }` and sends `message.read` to the sender. |

A message: `{ id, match_id, sender_id, type: "text", body, created_at, read_at }`.

**Rate limit:** 30 messages a minute per member, across all chats: `429 MESSAGE_RATE_LIMITED` with `details.retry_after`.

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
| server → client | `error` | `{ code, message }`, the same codes as REST. The socket stays open |

The socket registry is in-process for now (one API task). Running several tasks needs Redis pub/sub fan-out behind the same `RealtimeRegistry` interface.

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
| POST | `/admin/users/:id/unban` | Body `{ reason }`. Lifts a ban or suspension and its blacklist entries. `409` if the member isn't banned or suspended. |

`reason` is 3–1,000 characters and goes into the member's enforcement history (`enforcement_actions`) and the audit log. When `report_id` is given it must be an open report about that member, and it's resolved as `actioned`.

**Console sign-in:** moderators sign in to the console with the same phone OTP as the app, and the console then checks `/admin/me`. Tokens stay in httpOnly, Secure, SameSite=Strict cookies, and the console calls the API from its server only. SECURITY.md §3 still requires SSO with MFA plus the IP allowlist / VPN in front of the console before launch.

## Error codes

Every error has the shape `{ "error": { "code", "message", "details"? } }`. Clients switch on `code`.

- **Auth:** `UNAUTHENTICATED`, `INVALID_TOKEN`, `INVALID_PHONE`, `OTP_INVALID` (`details.attempts_left`), `OTP_EXPIRED`, `OTP_LOCKED`, `OTP_RATE_LIMITED`, `OTP_DELIVERY_FAILED`, `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_REUSED`, `ACCOUNT_SUSPENDED`
- **Onboarding:** `UNDERAGE`, `SIGNUP_BLOCKED`, `PHONE_ALREADY_REGISTERED`
- **Discovery and matching:** `LOCATION_REQUIRED`, `DAILY_LIKE_LIMIT`, `PLUS_REQUIRED`
- **Media:** `PHOTO_LIMIT`, `MIN_PHOTOS`, `UPLOAD_NOT_FOUND`, `INVALID_IMAGE`, `MEDIA_UNAVAILABLE`
- **General:** `VALIDATION_FAILED` (`details.fields[]`), `NOT_FOUND`, `FORBIDDEN`, `NOT_IMPLEMENTED`, `INTERNAL`
- **Messaging and safety:** `MESSAGE_RATE_LIMITED`, `REPORT_RATE_LIMITED`
- **Verification:** `VERIFICATION_REQUIRED` (403 on likes, messages and other gated routes), `VERIFICATION_UNAVAILABLE`, `ALREADY_VERIFIED`, `UNDER_REVIEW`, `INVALID_SIGNATURE`
- **Later sprints:** `NOT_MATCHED`, `PHOTOS_LOCKED`
