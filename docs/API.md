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

| Method | Path | Gate | Description |
|---|---|---|---|
| POST | `/auth/otp/request` | 🔓 | Body `{ phone, channel: "sms" \| "whatsapp" }`. Limited to 3 requests per 10 minutes per phone and device. |
| POST | `/auth/otp/verify` | 🔓 | Body `{ phone, code }`. Returns `{ access_token, refresh_token, is_new_user }`. |
| POST | `/auth/refresh` | 🔓 | Body `{ refresh_token }`. Rotates both tokens. |
| POST | `/auth/logout` | 🔑 | Revokes the current device session. |
| GET | `/auth/sessions` | 🔑 | Lists active device sessions. |
| DELETE | `/auth/sessions/:id` | 🔑 | Revokes a session. |

## Account & Profile

| Method | Path | Gate | Description |
|---|---|---|---|
| POST | `/me/onboarding` | 🔑 | Body `{ first_name, date_of_birth, gender, interested_in, intent }`. Returns `403 UNDERAGE` if the DOB is under 18. |
| GET | `/me` | 🔑 | Your account, profile, preferences and verification state. |
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

## Error codes (initial)

`UNDERAGE`, `NOT_AGE_VERIFIED`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_RATE_LIMITED`, `DAILY_LIKE_LIMIT`, `NOT_MATCHED`, `PHOTOS_LOCKED`, `ACCOUNT_SUSPENDED`, `PLUS_REQUIRED`, `VALIDATION_FAILED`.
