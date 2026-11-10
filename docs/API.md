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
| POST | `/auth/otp/verify` | 🔓 | Body `{ challenge_id, code }`. Existing member: `{ status: "signed_in", access_token, refresh_token, token_type, expires_in }`. New number: `{ status: "signup_required", signup_token, expires_in: 1800 }`. |
| POST | `/auth/refresh` | 🔓 | Body `{ refresh_token }`. Rotates the token. Replaying an already-rotated token returns `REFRESH_TOKEN_REUSED` and revokes every session in that family. |
| POST | `/auth/logout` | 🔑 | Revokes the current device session (takes effect immediately). |
| GET | `/auth/sessions` | 🔑 | `{ sessions: [{ id, platform, device_model, created_at, last_used_at, current }] }`. |
| DELETE | `/auth/sessions/:id` | 🔑 | Revokes one of your sessions. |

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
| PATCH | `/me/preferences` | 🔑 | `age_min` must be at least 18, `max_distance_km` must be 1–300, plus `interested_in`. |
| POST | `/me/pause` · `/me/resume` | 🔑 | Hide or show your profile in discovery. |
| POST | `/me/data-export` | 🔑 | Queues an export of your data (NDPA access right). |
| DELETE | `/me` | 🔑 | Schedules deletion with a 30-day recovery window. |
| GET | `/profiles/:userId` | 🔑 | Someone else's public profile. Only returned if they're discoverable to you or you're matched. Unverified members can view profiles, because browsing is open (PRD §5.3a). |

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

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/conversations` | ✅ | Paginated, sorted by the latest message. |
| GET | `/conversations/:id/messages?cursor=` | ✅ | Message history. |
| POST | `/conversations/:id/messages` | ✅ | Body `{ type: "text", body }` or `{ type: "image", photo_upload_id }`. Images only once photos are unlocked. |
| POST | `/conversations/:id/read` | ✅ | Body `{ up_to_message_id }`. |
| DELETE | `/conversations/:id/messages/:msgId` | ✅ | Deletes the message for everyone (your own messages only). |

### WebSocket: `wss://api.amivara.com/v1/ws`
Authenticate with the access token when connecting.

| Direction | Event | Payload |
|---|---|---|
| server → client | `message.new` | `{ conversation_id, message }` |
| server → client | `message.read` | `{ conversation_id, up_to_message_id }` |
| server → client | `typing` | `{ conversation_id, user_id }` |
| server → client | `match.created` | `{ match_id, user }` |
| server → client | `match.removed` | `{ match_id }` |
| client → server | `typing` | `{ conversation_id }` |

## Safety

| Method | Path | Gate | Description |
|---|---|---|---|
| POST | `/safety/blocks` | 🔑 | Body `{ user_id }`. |
| DELETE | `/safety/blocks/:userId` | 🔑 | Unblock. |
| GET | `/safety/blocks` | 🔑 | List of people you've blocked. |
| POST | `/safety/reports` | 🔑 | Body `{ user_id, category, details?, message_id? }`. Reporting also blocks the person automatically. |

## Error codes

Every error has the shape `{ "error": { "code", "message", "details"? } }`. Clients switch on `code`.

- **Auth:** `UNAUTHENTICATED`, `INVALID_TOKEN`, `INVALID_PHONE`, `OTP_INVALID` (`details.attempts_left`), `OTP_EXPIRED`, `OTP_LOCKED`, `OTP_RATE_LIMITED`, `OTP_DELIVERY_FAILED`, `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_REUSED`, `ACCOUNT_SUSPENDED`
- **Onboarding:** `UNDERAGE`, `SIGNUP_BLOCKED`, `PHONE_ALREADY_REGISTERED`
- **Discovery and matching:** `LOCATION_REQUIRED`, `DAILY_LIKE_LIMIT`, `PLUS_REQUIRED`
- **Media:** `PHOTO_LIMIT`, `MIN_PHOTOS`, `UPLOAD_NOT_FOUND`, `INVALID_IMAGE`, `MEDIA_UNAVAILABLE`
- **General:** `VALIDATION_FAILED` (`details.fields[]`), `NOT_FOUND`, `NOT_IMPLEMENTED`, `INTERNAL`
- **Verification:** `VERIFICATION_REQUIRED` (403 on likes, messages and other gated routes), `VERIFICATION_UNAVAILABLE`, `ALREADY_VERIFIED`, `UNDER_REVIEW`, `INVALID_SIGNATURE`
- **Later sprints:** `NOT_MATCHED`, `PHOTOS_LOCKED`
