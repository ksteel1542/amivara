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
| PATCH | `/me/profile` | 🔑 | Update bio, prompts, interests and other profile fields. |
| PATCH | `/me/preferences` | 🔑 | `age_min` must be at least 18, `max_distance_km` must be 1–300, plus `interested_in`. |
| PUT | `/me/location` | 🔑 | Body `{ lat, lng }`. Rounded on the server, and only the latest is kept. |
| POST | `/me/photos/upload-url` | 🔑 | Returns a signed upload URL and a `photo_id`. |
| POST | `/me/photos/:id/confirm` | 🔑 | Starts moderation. |
| PATCH | `/me/photos/order` | 🔑 | Body `{ photo_ids: [] }`. |
| DELETE | `/me/photos/:id` | 🔑 | Removes a photo. At least 2 must remain. |
| POST | `/me/pause` · `/me/resume` | 🔑 | Hide or show your profile in discovery. |
| POST | `/me/data-export` | 🔑 | Queues an export of your data (NDPA access right). |
| DELETE | `/me` | 🔑 | Schedules deletion with a 30-day recovery window. |
| GET | `/profiles/:userId` | 🔑 | Someone else's public profile. Only returned if they're discoverable to you or you're matched. Unverified members can view profiles, because browsing is open (PRD §5.3a). |

## Verification

| Method | Path | Gate | Description |
|---|---|---|---|
| POST | `/verification/sessions` | 🔑 | Body `{ type: "id_liveness" }`. Returns the provider SDK token. |
| GET | `/verification/status` | 🔑 | `{ phone, id_document, liveness, age_verified }`. |
| POST | `/verification/webhook` | Provider (HMAC) | Callback from the KYC provider. |

## Discovery & Matching

| Method | Path | Gate | Description |
|---|---|---|---|
| GET | `/discovery/candidates?limit=10` | 🔑 | A ranked stack of profile cards with rounded distance. |
| POST | `/matching/likes` | ✅ | Body `{ user_id, is_super? }`. Returns `{ matched: bool, match_id? }`. Daily limit applies. |
| POST | `/matching/passes` | ✅ | Body `{ user_id }`. |
| POST | `/matching/rewind` | ✅ Plus | Undo your last pass. |
| GET | `/matching/likes/received` | ✅ | Free members get a blurred count. Plus members get the full list. |
| GET | `/matches` | ✅ | Paginated list of your matches. |
| DELETE | `/matches/:id` | ✅ | Unmatch. Removes the conversation for both members. |

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
- **General:** `VALIDATION_FAILED` (`details.fields[]`), `NOT_FOUND`, `NOT_IMPLEMENTED`, `INTERNAL`
- **Later sprints:** `NOT_AGE_VERIFIED`, `DAILY_LIKE_LIMIT`, `NOT_MATCHED`, `PHOTOS_LOCKED`, `PLUS_REQUIRED`
