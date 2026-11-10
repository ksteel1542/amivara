# AMIVARA: Product Requirements Document

**Status:** Draft v0.2 · **Owner:** Founder · **Launch market:** Nigeria · **MVP platforms:** Android (Flutter) + Web (Next.js)

## Founder decisions (2026-11-10)

| Decision | Outcome |
|---|---|
| Identity verification provider | **Smile ID** for KYC, liveness (SmartSelfie™) and document/ID verification |
| Database ORM | **Prisma** on PostgreSQL + PostGIS |
| Launch platform | **Android-only** mobile app (Flutter) plus the Next.js web ecosystem. **iOS comes after launch.** |
| Verification gating | **"Verify later" is allowed.** Members who haven't verified can **browse** profiles. **Liking, Super Liking and messaging require a passed Smile ID verification** (see §5.3a) |
| Cloud region | **AWS Cape Town (`af-south-1`)** as the primary region, with **Amazon CloudFront** serving Nigerian members from its Lagos edge locations |
| Design tokens | `design/brand/tokens.json` (AMIVARA ROSE) is the single source of truth for colour, type and spacing |
| Unverified accounts | **Confirmed:** auto-pause after 30 days without verification, and AMIVARA Plus can only be bought after verification (§5.3a) |

## 1. Summary

AMIVARA is a mobile-first dating and connection platform **for adults aged 18 and over**. It helps verified adults find mutual, respectful connections. Safety and authenticity come first, and engagement metrics come second.

## 2. Goals

1. Build a trusted community where every active member is a verified adult.
2. Only mutual interest can open a conversation.
3. Work on mid-range Android devices and unstable networks across Nigeria.
4. Reach sustainable revenue through an optional premium tier.

### Non-goals (MVP)
- Video calling, livestreaming, public feeds or group chat.
- Under-18 access of any kind. There is no "teen mode".
- Markets outside Nigeria before the launch is stable.
- An iOS app. Flutter keeps iOS possible later, but no iOS builds, App Store submission or Apple billing are in MVP scope.

## 3. Target users

- Adults aged 18–45 in urban Nigeria (Lagos, Abuja first, then Port Harcourt, Ibadan, Enugu, Kano).
- Users who want a serious relationship, friendship or casual dating, chosen explicitly through an "intent" setting.
- Members of the diaspora who want to connect with people at home (phase 2).

## 4. Eligibility and age rules

- **Minimum age: 18.** Date of birth is collected at signup. Anyone under 18 is blocked immediately and cannot try again with the same phone number or device.
- Age is **assured** by an ID document check plus a liveness selfie before messaging is unlocked (see §7).
- A self-declared DOB that doesn't match the verified ID age causes the account to be held for review.
- Members can set an age-range preference, but nobody can ever set it below 18.

## 5. Core features (MVP)

### 5.1 Onboarding
1. Phone number entry → OTP (SMS, with WhatsApp as fallback).
2. DOB, then an 18+ gate.
3. Profile basics: first name, gender, interested in, intent, city.
4. Photos: at least 2, at most 6. Every photo goes through automated moderation.
5. Identity and liveness verification through the **Smile ID** SDK, which runs inside the app on Android and in the browser on web. Members can browse before it's done, but cannot like or message until it's complete.
6. Accept the Terms, Community Guidelines and Privacy Policy, and give explicit location consent.

### 5.2 Profile
- Photos, a bio of up to 500 characters, prompts (up to 3), interests (up to 10), languages (English, Yoruba, Igbo, Hausa, Pidgin and more), height, education, job, religion (optional) and intent.
- A verification badge appears once ID and liveness checks pass.
- Fields marked optional can be hidden.

### 5.3 Discovery
- A card stack of candidates filtered by mutual preferences (see §6), distance radius and age range.
- Distance is shown rounded (for example "~5 km away") and never as exact coordinates.
- Actions: **Like**, **Pass**, **Super Like** (premium, limited).
- Daily free like limit (configurable, 50 to start).

### 5.3a Verification gating ("Verify later")

Members can skip verification at the end of onboarding (the "I'll do it later" option in UI_WIREFRAMES Screen 4). Until Smile ID verification passes:

| Capability | Unverified (phone-verified, 18+ declared) | Verified (Smile ID passed, 18+ confirmed) |
|---|---|---|
| Browse the discovery stack and view profiles | ✅ | ✅ |
| Edit their own profile and photos | ✅ | ✅ |
| **Appear in other members' discovery** | ❌ Hidden | ✅ |
| **Like / Super Like** | ❌ The Like button opens the verification prompt | ✅ |
| Pass | ✅ (only affects their own stack) | ✅ |
| **Messaging** | ❌ | ✅ |
| Block / report | ✅ | ✅ |
| AMIVARA Plus purchase | ❌ (so nobody pays for features they can't use yet) | ✅ |

- Unverified members are **never shown** to others. This means an unverified account can't be contacted or seen, so nobody can use the "verify later" period to reach other members.
- Members who haven't verified see a persistent "Verify to start liking and chatting" banner. Reminder pushes are capped at 3 over 7 days.
- Unverified accounts are browse-only. After **30 days** without verification, the account is paused automatically and the member has to verify to come back. This stops dormant unverified accounts building up.
- The gate is enforced **on the server** (`NOT_AGE_VERIFIED`, API gate ✅). The client UI is only a convenience.

### 5.4 Matching
- A match is created **only when both members have liked each other**.
- Either member can unmatch at any time. After an unmatch, the conversation disappears for both and neither can find the other again.

### 5.5 Messaging
- 1:1 text chat between matched members only.
- Photo messages only after both members have sent at least 3 messages each, and every photo is moderated.
- Read receipts and typing indicators (members can turn these off).
- Report and block are available inside every chat.

### 5.6 Safety
- Report categories: fake profile, underage suspicion, harassment, scam or financial request, explicit content without consent, hate, other.
- A report of **underage suspicion** suspends the reported account immediately until review.
- Block hides both members from each other everywhere.
- Safety tips are shown before a member's first conversation and before they share contact details.

### 5.7 Account controls
- Pause the profile (hidden from discovery, existing matches stay).
- Incognito (premium): only people you've liked can see you.
- Download your data, and delete your account (with a 30-day recovery window, then permanent deletion).

### 5.8 Monetisation (post-MVP within launch)
- **AMIVARA Plus**: unlimited likes, see who liked you, 5 Super Likes a week, incognito, rewind.
- Paid in NGN. On Android, purchases go through Google Play Billing wherever Play policy requires it. On web, they go through Paystack or Flutterwave. Apple billing comes with the iOS release.

## 6. Mutual matching rules

A candidate B appears for member A only if **all** of the following are true:

1. Both A and B are active, not paused, and **verified 18+**.
2. B's gender is in A's "interested in" and A's gender is in B's "interested in".
3. B's age is within A's age range **and** A's age is within B's age range.
4. The distance between them is within A's radius **and** within B's radius.
5. Neither has blocked, reported or unmatched the other.
6. A hasn't already liked or passed B (passes come back after 30 days if A chooses).
7. Neither has a pending trust-and-safety hold.

Ranking (v1): verified photo quality, recent activity, profile completeness and a small amount of randomness. There is no "desirability" scoring based on race, ethnicity or religion.

## 7. Identity verification requirements

| Check | When | Method |
|---|---|---|
| Phone ownership | Signup | OTP over SMS or WhatsApp, 6 digits, 5-minute expiry, max 5 attempts |
| One account per phone | Signup | Unique, normalised E.164 phone number |
| Age (18+) | Before liking or messaging | **Smile ID Biometric KYC**: the NIN is checked against the NIMC record with a selfie match. **Smile ID Document Verification** is the fallback (international passport, driver's licence, voter's card). Either way, the DOB is returned |
| Liveness / face match | Together with the ID check | **Smile ID SmartSelfie™** liveness, matched against the ID or NIMC photo |
| Ongoing photo match | Each new photo | Face similarity checked against the verified selfie. Smile ID SmartSelfie Authentication is used for re-verification (for example when the member logs in on a new device) |

- Smile ID is the only KYC provider at launch. The backend wraps it behind a `VerificationProvider` interface so that adding a second provider later doesn't change the product flow.
- AMIVARA stores **only** the result: pass/fail, verified age band, the Smile ID job reference and result code. We never store the raw ID image or the full NIN. Smile ID's own data retention is set by the DPA we sign with them.
- If verification fails, the member can retry twice before a manual review.

## 8. Success metrics

- Share of new signups who become verified within 7 days (target 60% or more).
- Reports per 1,000 messages (keep trending down).
- Match rate per active member each week.
- Day-30 retention (target 25% or more).
- Median time to resolve a report (target under 24 hours, and under 1 hour for underage reports).

## 9. Compliance

- Nigeria Data Protection Act 2023 (NDPA) and NDPC guidance: a lawful basis, a DPO, a DPIA before launch, and breach notification within 72 hours.
- App Store and Google Play dating-app policies (age gating, reporting, moderation).
- Terms and Community Guidelines reviewed by Nigerian counsel before launch.

## 10. Open questions

1. ~~Which KYC provider?~~ **Decided: Smile ID.**
2. ~~Should we require verification before browsing?~~ **Decided: "verify later" is allowed. Browsing is open, but liking and messaging require Smile ID (§5.3a).**
3. ~~Should iOS ship at MVP?~~ **Decided: Android-only MVP, iOS after launch.**
4. What price should Plus have in NGN, and should there be weekly plans?
5. What does a Smile ID check cost per verification at our expected volumes? Should we charge for re-verification attempts?
