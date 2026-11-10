# AMIVARA: Onboarding & Verification Wireframes (Android MVP)

**Stage:** 2 (Brand & UI Prototypes) · **Status:** Draft v0.1 · **Theme:** [AMIVARA ROSE](../design/brand/AMIVARA_ROSE.md)
**Platform:** Android · Material 3 · minSdk 24 (Android 7.0) · portrait only · reference frame 360 × 800dp

## 0. Flow overview

```
[1 Welcome] → [2a Phone] → [2b OTP] → [3 Date of birth / 18+ gate] ──(under 18)──▶ [3x Not eligible]
                                              │
                                              ▼
                              (profile basics, photos: separate spec)
                                              │
                                              ▼
                         [4 Smile ID explainer] → [5a Choose method] → [5b SmartSelfie™]
                                              │                          │
                                         "Do it later"                   ▼
                                              │             [5c NIN entry  or  5c' Document capture]
                                              ▼                          ▼
                                    Browse-only mode         [5d Submitting] → [5e Result]
                                                                          PASSED · PENDING · FAILED · REVIEW
```

**Global rules for every screen**
- 24dp side gutters, the `surface` background (ivory or night), and the primary CTA as a full-width pill button at the bottom (56dp tall, 24dp from the bottom).
- A linear progress indicator at the top for steps 2–5 (`primary` on `surfaceContainer`).
- System back works on every screen except 5d (submitting) and 3x (not eligible).
- Every string is externalised for localisation (English first, with Pidgin, Yoruba, Igbo and Hausa later).
- Accessibility: TalkBack labels on every control, 48dp touch targets, no meaning carried by colour alone, and correct layout at 200% font scale.
- Data-light: no video on any onboarding screen. Hero imagery is a single WebP under 80 KB, bundled in the APK.

---

## Screen 1: Welcome & Warm Brand Introduction

**Goal:** make a warm first impression, set expectations (18+ and verified), and start signup or log in.

```
┌──────────────────────────────────┐
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  ← Burgundy (#52182F) hero, top 60%
│░░░░                          ░░░░│    warm-toned photo of two adults
│░░░░      [ photo, 4:5 ]      ░░░░│    laughing, with a burgundy gradient
│░░░░                          ░░░░│    scrim over the bottom 40%
│░░░░          ✦ A             ░░░░│  ← monogram, gold apex
│░░░░       A M I V A R A      ░░░░│  ← wordmark, ivory
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│                                  │
│   Real connections between       │  ← headlineLarge, Playfair, burgundy
│   verified adults.               │
│                                  │
│   ◈ Every member is 18+ and      │  ← bodyMedium, gold-700 rosette icons
│     identity-verified            │
│   ◈ You only chat when it's      │
│     mutual                       │
│                                  │
│  ┌────────────────────────────┐  │
│  │       Create account       │  │  ← Filled pill, Deep Rose
│  └────────────────────────────┘  │
│        I already have an account │  ← Text button, Deep Rose
│                                  │
│  By continuing you agree to our  │  ← bodySmall, ink-600
│  Terms and Privacy Policy. 18+   │    links underlined
└──────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Hero | Burgundy background, photo with `radius-lg` on the bottom corners only, monogram and wordmark on top. In dark mode, the hero blends into the night canvas. |
| Value props | Exactly 2 lines, with the gold rosette icon (the verified motif). No more. |
| Primary CTA | "Create account" → Screen 2a (signup mode) |
| Secondary | "I already have an account" → Screen 2a (login mode, same UI, different copy) |
| Legal | Links to Terms and Privacy Policy open in a Chrome Custom Tab |
| Motion | The hero fades in (`motion-long`), then the copy rises in by 8dp (`motion-medium`) |

**Analytics:** `onboarding_welcome_viewed`, `onboarding_cta_tapped{mode}`

---

## Screen 2: Secure Phone Number Authentication & OTP

### 2a: Phone number

```
┌──────────────────────────────────┐
│ ←                         ▬▬░░░░ │  ← back, progress 1/5
│                                  │
│  What's your number?             │  ← headlineLarge, Playfair
│  We'll text you a code to make   │  ← bodyLarge, ink-600
│  sure it's really you.           │
│                                  │
│  ┌───────┐ ┌──────────────────┐  │
│  │🇳🇬 +234▾│ │ 801 234 5678     │  │  ← country picker + outlined field
│  └───────┘ └──────────────────┘  │    (NG is the default, list limited)
│                                  │
│  Send code via                   │  ← labelLarge
│  (●) SMS     ( ) WhatsApp        │  ← segmented button (M3)
│                                  │
│  🔒 Your number is never shown on  │  ← bodySmall with a lock icon
│     your profile.                │
│                                  │
│  ┌────────────────────────────┐  │
│  │          Send code         │  │  ← disabled until the number is valid
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

| Rule | Detail |
|---|---|
| Input | `keyboardType: phone`. Formats as the member types (`801 234 5678`). Strips a leading `0` (e.g. `0801…` → `+234 801…`). Validated with `libphonenumber` for a Nigerian mobile number. |
| Autofill | Android phone number hint API (`GetPhoneNumberHintIntentRequest`, where Play Services is available) |
| Channel | SMS by default. WhatsApp is offered as the fallback for people with poor SMS delivery. |
| API | `POST /auth/otp/request { phone, channel }` |
| Errors | `OTP_RATE_LIMITED` → "Too many tries. Please wait {mm:ss}." (an inline banner with a countdown). Network failure → a snackbar with a retry. |

### 2b: Enter the code

```
┌──────────────────────────────────┐
│ ←                         ▬▬▬░░░ │
│                                  │
│  Enter your code                 │  ← headlineLarge
│  Sent by SMS to +234 801 234 5678│  ← bodyMedium
│  Change number                   │  ← text button
│                                  │
│   ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐  │  ← 6 boxes, 48×56dp, radius-sm
│   │ 4│ │ 7│ │ 1│ │  │ │  │ │  │  │    the focused box has a 2dp rose outline
│   └──┘ └──┘ └──┘ └──┘ └──┘ └──┘  │
│                                  │
│  Resend code in 0:42             │  ← ink-600, becomes a button at 0:00
│  Didn't get it? Try WhatsApp     │  ← appears after the first resend
│                                  │
│  ┌────────────────────────────┐  │
│  │           Verify           │  │  ← submits automatically on the 6th digit
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

| Rule | Detail |
|---|---|
| Autofill | **SMS User Consent API** (the member taps "Allow" and the code fills in). We don't use the SMS Retriever hash, so there's no special SMS format to depend on. Also `autofillHints: oneTimeCode`. |
| Expiry | The code is valid for 5 minutes. The resend cooldown is 60 seconds the first time, then 120 seconds. |
| API | `POST /auth/otp/verify { phone, code }` → tokens are saved in `flutter_secure_storage` |
| Errors | `OTP_INVALID` → the boxes shake (`motion-short`), the error colour shows and "That code isn't right. {n} tries left." appears. After 5 wrong attempts the member is locked out, with a countdown. `OTP_EXPIRED` → "Code expired. We've sent a new one." |
| Routing | `is_new_user = true` → Screen 3. If the member already exists, it goes to Home, or to Screen 4 if they aren't verified yet. |

**Analytics:** `otp_requested{channel}`, `otp_verified`, `otp_failed{reason}`

---

## Screen 3: 18+ Age Assurance Gate & Date of Birth Picker

**Goal:** collect the date of birth and block anyone under 18, **without coaching** them to enter a different date.

```
┌──────────────────────────────────┐
│ ←                         ▬▬▬▬░░ │
│                                  │
│  When's your birthday?           │  ← headlineLarge
│  AMIVARA is for adults 18 and    │  ← bodyLarge
│  over. Your age shows on your    │
│  profile, but your birthday      │
│  doesn't.                        │
│                                  │
│  ┌──────┐ ┌──────────┐ ┌───────┐ │
│  │ DD   │ │ Month  ▾ │ │ YYYY  │ │  ← three outlined fields
│  └──────┘ └──────────┘ └───────┘ │    Day: number · Month: dropdown · Year: number
│                                  │
│  ⓘ You'll confirm this with your │  ← bodySmall, gold-700 icon
│    ID in a later step, so make   │
│    sure it matches.              │
│                                  │
│  ┌────────────────────────────┐  │
│  │          Continue          │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

**Why three fields instead of the M3 date picker:** the standard picker opens on today's date, which makes members scroll back decades and so encourages careless entry. Three fields are faster, work better with TalkBack, and don't suggest any particular year. The month is a dropdown (Jan–Dec) so there's no confusion between DD/MM and MM/DD.

**Confirmation dialog** (an M3 `AlertDialog`, shown after a valid date of 18+):

```
┌──────────────────────────────┐
│  You're 27                   │  ← headlineSmall, Playfair
│                              │
│  Born 14 March 1999. You     │
│  can't change this later.    │
│                              │
│        Edit      Confirm     │
└──────────────────────────────┘
```

| Rule | Detail |
|---|---|
| Validation | A real calendar date, a year from 1926 up to the current year, and no future dates. Age is calculated in the **Africa/Lagos** time zone on the device and checked again on the server. |
| Under 18 | → **Screen 3x**. The API returns `403 UNDERAGE` as well, so the server enforces it even if the client is modified. |
| Lock-in | The DOB is final once confirmed. Any later difference from the Smile ID-verified DOB sends the account to manual review (SECURITY.md §1). |
| API | `POST /me/onboarding { date_of_birth, … }` (sent together with the profile basics) |

### 3x: Not eligible (under 18)

```
┌──────────────────────────────────┐
│                                  │
│            ( ✦ )                 │  ← simple line illustration, burgundy
│                                  │
│  AMIVARA is for adults only      │  ← headlineMedium
│                                  │
│  You need to be 18 or older to   │  ← bodyLarge
│  use AMIVARA. We've closed this  │
│  signup and haven't saved your   │
│  details.                        │
│                                  │
│  ┌────────────────────────────┐  │
│  │           Close            │  │  ← exits the app
│  └────────────────────────────┘  │
│  Learn about staying safe online │  ← link to a youth online-safety resource
└──────────────────────────────────┘
```

- **No back button and no "edit date" option.** The device and phone hash are blocked from signing up for 12 months (SECURITY.md §1).
- The tone is kind, not punitive. We never say "come back when you're 18 + n".
- Analytics: `age_gate_blocked`. The event contains no DOB.

**Analytics:** `dob_entered`, `dob_confirmed`, `age_gate_blocked`

---

## Screen 4: Smile ID Pre-Check Explainer ("Verified, not anonymous")

**Goal:** explain why we verify, what happens and what we store, so members trust the process and complete it. This is the screen that has the most effect on how many people finish verification.

```
┌──────────────────────────────────┐
│ ←                         ▬▬▬▬▬░ │
│                                  │
│         ╭───────────╮            │  ← gold rosette badge (large, 96dp)
│         │    ✓      │            │    with a gentle gold shimmer, once
│         ╰───────────╯            │
│                                  │
│  Verified, not anonymous.        │  ← headlineLarge, Playfair, centred
│                                  │
│  Everyone on AMIVARA proves      │  ← bodyLarge, centred
│  they're a real adult. It takes  │
│  about 2 minutes.                │
│                                  │
│  ① Take a quick selfie           │  ← numbered list, titleMedium + body
│     A short check that it's      │
│     really you, live.            │
│  ② Confirm your ID               │
│     Your NIN, or a photo of your │
│     passport, licence or voter's │
│     card.                        │
│  ③ Get your gold badge           │
│     Then you can like and chat.  │
│                                  │
│  ┌──────────────────────────────┐│
│  │ 🔒 What we keep               ││  ← surfaceContainer card, radius-md
│  │ Only "verified 18+" and your  ││
│  │ age range. We never store your││
│  │ ID photo or full NIN.         ││
│  │ Secured by Smile ID ›         ││  ← opens a bottom sheet with details
│  └──────────────────────────────┘│
│                                  │
│  ┌────────────────────────────┐  │
│  │      Start verification    │  │  ← Filled pill, Deep Rose
│  └────────────────────────────┘  │
│           I'll do it later       │  ← Text button
└──────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Badge | The gold `#D4AF37` rosette is shown here so members link it to *trust* before they've earned it |
| "Secured by Smile ID" sheet | Explains in plain language who Smile ID is, that checks run against NIMC records, how long Smile ID keeps data under its DPA, and links to the privacy policy section. Smile ID's logo appears only as their brand guidelines allow. |
| Camera permission | **Not** requested here. We ask just before the selfie (5b), with our own explanation first. |
| "I'll do it later" | Goes to the profile basics and then **browse-only mode**. A persistent banner reads "Verify to start liking and chatting". Reminder pushes are capped at 3 over 7 days. |
| Pre-flight check | Needs a front camera and at least 1 GB of RAM. If the device fails, the member is offered **web verification** (a QR code or link to the Next.js flow). |
| API | Nothing is called until "Start". Then `POST /verification/sessions` |

**Analytics:** `verify_explainer_viewed`, `verify_started`, `verify_deferred`, `verify_info_sheet_opened`

---

## Screen 5: SmartSelfie™ & Biometric KYC Capture Flow

The camera screens and quality checks are provided by the **Smile ID Flutter SDK** (Android). We control the screens before and after the capture, and we theme the SDK screens as far as the SDK allows: primary colour, fonts and corner radius. The SDK sends images **directly to Smile ID**, so they never pass through AMIVARA servers.

### 5a: Choose how to verify

```
┌──────────────────────────────────┐
│ ←                         ▬▬▬▬▬▬ │
│  How would you like to confirm   │  ← headlineMedium
│  your ID?                        │
│                                  │
│  ┌──────────────────────────────┐│
│  │ (●) NIN               FASTEST ││  ← radio card, gold-700 chip
│  │     Enter your 11-digit NIN.  ││    default selection
│  │     No photo of your card     ││
│  │     needed.                   ││
│  └──────────────────────────────┘│
│  ┌──────────────────────────────┐│
│  │ ( ) Photo of an ID document   ││
│  │     Passport, driver's        ││
│  │     licence or voter's card   ││
│  └──────────────────────────────┘│
│                                  │
│  ┌────────────────────────────┐  │
│  │          Continue          │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

- **NIN** → Smile ID **Biometric KYC** (5b, then 5c). **Document** → Smile ID **Document Verification** (5b, then 5c′).
- Selfie first in both paths, so the hardest step happens while the member is most motivated.

### 5b: SmartSelfie™ capture

**Before the SDK opens**, we show our own camera explanation, then the system permission dialog:

```
┌──────────────────────────────────┐
│  📷  Camera access                │
│  We use your camera once, for a  │
│  live selfie check. It's not     │
│  saved to your gallery.          │
│                                  │
│  Tips: find good light · remove  │  ← three icon chips
│  glasses & cap · face the camera │
│                                  │
│  [        Allow camera        ]  │  → system permission dialog
└──────────────────────────────────┘
```

**Inside the SDK (Smile ID screens, themed):**
```
┌──────────────────────────────────┐
│  ✕                               │
│        ╭──────────────╮          │  ← face oval, rose outline turning
│       │                │         │    gold-500 when aligned
│       │   (live feed)  │         │
│       │                │         │
│        ╰──────────────╯          │
│                                  │
│   Move closer · Hold still       │  ← SDK guidance in real time
│   ▬▬▬▬▬▬▬▬▬░░░░  capturing…      │
└──────────────────────────────────┘
```

| State | Handling |
|---|---|
| Permission denied | An inline card: "We need your camera to verify you." → "Open settings". If denied permanently, the web verification option is offered. |
| Poor light, face not found, timeout | Shown by the SDK. After 3 failed captures, we show a tips sheet and a "Try again" button |
| Member cancels (✕) | Goes back to 5a and keeps their choice. Analytics `selfie_cancelled` |

### 5c: NIN entry (Biometric KYC path)

```
┌──────────────────────────────────┐
│ ←                                │
│  Enter your NIN                  │  ← headlineMedium
│  The 11-digit number on your NIN │
│  slip or in the NIMC app.        │
│                                  │
│  ┌──────────────────────────────┐│
│  │ 1234 5678 901                ││  ← number field, grouped 4-4-3
│  └──────────────────────────────┘│     masked after entry: •••• •••• 901
│                                  │
│  Where do I find my NIN? ›       │  ← bottom sheet: dial *346#, NIMC app
│                                  │
│  🔒 Checked securely with NIMC    │
│     through Smile ID. We don't    │
│     store your NIN.               │
│                                  │
│  ┌────────────────────────────┐  │
│  │      Verify my identity    │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

- Validation on the device: exactly 11 digits. The field uses `FLAG_SECURE`, so it can't be screenshotted or captured in screen recordings.
- The NIN is passed to the Smile ID SDK in memory and never saved on the device or sent to AMIVARA's API.

### 5c′: Document capture (Document Verification path)

- Document type selector (passport, driver's licence, voter's card). Then the SDK captures the **front** (and the **back** for a licence or voter's card), with automatic edge detection and glare and blur checks.
- Our wrapper screen gives the tips "Place it on a dark, flat surface" and "Avoid glare".

### 5d: Submitting

```
┌──────────────────────────────────┐
│                                  │
│         ◌  (rose spinner)        │
│                                  │
│  Checking your details…          │  ← headlineSmall
│  This usually takes under a      │
│  minute. You can keep the app    │
│  open or come back later.        │
│                                  │
└──────────────────────────────────┘
```

- **Back is disabled** while uploading. Once the SDK confirms the upload, the member can leave, and the result arrives by push notification (`verification.completed`).
- Status comes from polling `GET /verification/status` every 5 seconds for up to 60 seconds, with WebSocket and push as the main ways the result arrives.

### 5e: Result states

| Status | Visual | Copy | Action |
|---|---|---|---|
| **PASSED** (and age ≥ 18) | A gold rosette shimmer (`motion-long`) and `success` tint | "You're verified ✦" / "Your gold badge is on your profile. Time to meet someone real." | "Continue" → profile completion / Discovery |
| **PENDING** (callback not received yet) | Rose clock icon | "Almost there. We'll notify you as soon as it's done." | "Continue browsing" (browse-only mode) |
| **FAILED** (attempts 1–2) | Neutral illustration, no red "X" | Specific, kind reason from the Smile ID result code, mapped to member-friendly text (e.g. "Your selfie didn't match the NIMC photo. Try again in good light.") | "Try again" → 5a. "Use a different ID" |
| **MANUAL_REVIEW** (3rd failure, DOB mismatch, or an unclear result) | `warning` tint | "We're taking a closer look. Usually within 24 hours." | "OK". Liking and chatting stay locked |
| **Under 18 on the ID** | — | Same as **Screen 3x** | Account banned and data purged (SECURITY.md §1) |

**Analytics:** `verify_method_selected{method}`, `selfie_captured`, `selfie_cancelled`, `id_submitted{method}`, `verify_result{status, result_code_group}`. No personal data in events.

---

## 6. Open design questions for founder review

1. ~~Should "I'll do it later" exist?~~ **Decided: yes.** Browsing is open, but liking and messaging require Smile ID (PRD §5.3a).
2. Should the **WhatsApp OTP** option be visible straight away, or only appear after an SMS failure? It changes costs.
3. Should the **confirmation dialog** on Screen 3 show the age only, or the age and the full date?
4. Does Smile ID's commercial plan allow the white-label theming level we've assumed, including removing their branding from the SDK screens?

## 7. Next deliverables (Stage 2)

- [ ] Low-fidelity Figma frames for Screens 1–5 (light and dark)
- [ ] High-fidelity Figma frames with the ROSE tokens and a component library in `design/ui-components/`
- [ ] A clickable prototype for usability testing (10+ participants in Lagos and Abuja)
- [ ] The profile basics, photo upload, Discovery, Match and Chat wireframes (spec 2)
