# AMIVARA: Product Requirements Document

**Status:** Draft v0.1 · **Owner:** Founder · **Launch market:** Nigeria

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
5. Identity and liveness verification. Members can browse before it's done, but cannot like or message until it's complete.
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
- Paid in NGN through local payment gateways (Paystack or Flutterwave) and app store billing where the stores require it.

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
| Age (18+) | Before liking or messaging | Government ID (NIN slip, international passport, driver's licence, voter's card) checked by a KYC provider, with DOB extracted |
| Liveness / face match | Together with the ID check | Selfie liveness compared with the ID photo and the profile photos |
| Ongoing photo match | Each new photo | Face similarity checked against the verified selfie |

- The NIN is verified through a licensed provider. AMIVARA stores **only** the result (pass/fail, verified age band, provider reference), never the raw ID image beyond the provider's retention period.
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

1. Which KYC provider? Candidates: Smile ID, Youverify, Dojah, Prembly.
2. Should we require full verification before browsing, or only before interacting (current proposal)?
3. Should iOS ship at MVP or in the phase after launch?
4. What price should Plus have in NGN, and should there be weekly plans?
