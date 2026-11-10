# AMIVARA ROSE: Brand Tokens & Guidelines

**Status:** Approved direction (founder, 2026-11-10) · **Version:** 1.0 · **Applies to:** Android app (Flutter / Material 3), Next.js web, admin console (with a muted variant)

## 1. The vibe

> *Warm, assured, quietly luxurious. Like a handwritten invitation, not a nightclub flyer.*

AMIVARA ROSE pairs the depth of **rose and burgundy** with the light of **champagne gold** on a **warm ivory** canvas. It should feel:

| We are | We are not |
|---|---|
| Warm and welcoming | Loud, neon, "swipe-addicted" |
| Elegant and editorial | Corporate or clinical |
| Safe and verified, with that confidence on show | Anxious or full of warnings |
| Proudly Nigerian and contemporary | Generic Silicon Valley |
| Romantic **and** respectful | Sexualised or suggestive |

**Brand line:** *Verified, not anonymous.*
**Voice:** Warm, plain English. Short sentences. Speak to the member as an adult. Light Nigerian warmth is welcome ("You're in!"), but no slang in safety or legal copy.

## 2. Colour tokens

### 2.1 Core palette (approved)

| Token | Hex | Role |
|---|---|---|
| `rose-700` **Primary (Deep Rose)** | `#88304E` | Primary actions, active states, brand moments |
| `burgundy-900` **Secondary (Burgundy)** | `#52182F` | Headings on light, secondary surfaces, the onboarding hero |
| `gold-500` **Accent (Champagne Gold)** | `#D4AF37` | The verified badge, highlights, dividers, celebration moments |
| `ivory-50` **Canvas, light** | `#FDFBF7` | App background, light mode |
| `night-950` **Canvas, dark** | `#1A0B12` | App background, dark mode (Deep Burgundy-Black) |

### 2.2 Supporting tokens (derived, for accessibility)

These tokens exist so the core palette meets WCAG 2.2 AA contrast. All ratios below were measured.

| Token | Hex | Why it exists |
|---|---|---|
| `rose-300` | `#E8A5BC` | **The primary colour in dark mode.** `#88304E` on `#1A0B12` is only 2.34:1 and fails, while `#E8A5BC` reaches 9.58:1 |
| `gold-700` (Deep Gold) | `#8A6D12` | **Gold for text and icons on light backgrounds.** `#D4AF37` on ivory is only 2.03:1, so it must never be used for text on light. `#8A6D12` reaches 4.75:1 |
| `ink-900` | `#2A1A20` | Body text on light (16.04:1 on ivory) |
| `ink-600` | `#6B5A60` | Secondary text on light (6.24:1) |
| `mist-300` | `#BFAEB4` | Secondary text on dark (9.02:1 on night) |
| `night-800` | `#2A1520` | Raised surfaces and cards in dark mode |
| `ivory-100` | `#F6F0E8` | Raised surfaces and cards in light mode |
| `line-light` | `#E7DCD3` | Dividers and outlines on light |
| `line-dark` | `#3D2430` | Dividers and outlines on dark |
| `success` | `#2E7D5B` / dark `#7FD1AE` | Verification passed |
| `warning` | `#965C09` / dark `#F2C46D` | Under review (5.30:1 on ivory, 11.71:1 on night) |
| `error` | `#B3261E` / dark `#F2B8B5` | Errors (the Material 3 default, tuned for warmth) |

### 2.3 Measured contrast pairs

| Foreground on background | Ratio | Use |
|---|---|---|
| Ivory `#FDFBF7` on Rose `#88304E` | **8.14:1** ✅ | Primary button label (white gives the same result) |
| Rose `#88304E` on Ivory | **7.88:1** ✅ | Text buttons and links on light |
| Burgundy `#52182F` on Ivory | **13.28:1** ✅ | Headings on light |
| Gold `#D4AF37` on Burgundy `#52182F` | **6.53:1** ✅ | Gold accents on the burgundy hero |
| Gold `#D4AF37` on Night `#1A0B12` | **9.07:1** ✅ | Gold accents in dark mode |
| Night `#1A0B12` on Gold `#D4AF37` | **9.07:1** ✅ | Label on a gold chip or badge |
| Night on Rose-300 `#E8A5BC` | **9.58:1** ✅ | Primary button label in dark mode |
| Gold `#D4AF37` on Ivory | **2.03:1** ❌ | **Decoration only:** borders, glows, illustration. Never text |
| Rose `#88304E` on Night | **2.34:1** ❌ | **Never** in dark mode. Use `rose-300` |

### 2.4 Material 3 role mapping

| M3 role | Light | Dark |
|---|---|---|
| `primary` | `#88304E` | `#E8A5BC` |
| `onPrimary` | `#FFFFFF` | `#1A0B12` |
| `primaryContainer` | `#F9DCE5` | `#6A2440` |
| `onPrimaryContainer` | `#3A0A1C` | `#FFD9E3` |
| `secondary` | `#52182F` | `#E3BCC9` |
| `onSecondary` | `#FFFFFF` | `#2E0A18` |
| `tertiary` (accent) | `#8A6D12` | `#D4AF37` |
| `onTertiary` | `#FFFFFF` | `#1A0B12` |
| `surface` / `background` | `#FDFBF7` | `#1A0B12` |
| `surfaceContainer` | `#F6F0E8` | `#2A1520` |
| `onSurface` | `#2A1A20` | `#F5ECEF` |
| `onSurfaceVariant` | `#6B5A60` | `#BFAEB4` |
| `outline` | `#E7DCD3` | `#3D2430` |
| `error` | `#B3261E` | `#F2B8B5` |

> **Note:** turn off Material You dynamic colour (`dynamicColor = false`). AMIVARA always uses the ROSE palette, whatever the device wallpaper is.

### 2.5 Gold usage rules
1. **Gold means trust.** Its main job is the **verified badge** and verification success. Don't spend it on ordinary buttons.
2. Keep gold to no more than about 5% of any screen.
3. On light backgrounds, gold is either decoration (`#D4AF37`) or text and icons in `gold-700` (`#8A6D12`).
4. Never put gold on rose. They clash, and the contrast is weak.

## 3. Typography

### 3.1 Typefaces

| Role | Primary | Approved alternate | Licence |
|---|---|---|---|
| **Editorial / display** | **Playfair Display** | Cormorant Garamond | SIL OFL 1.1 |
| **UI / body** | **Inter** | Plus Jakarta Sans | SIL OFL 1.1 |

**Recommendation:** ship **Playfair Display + Inter** as the default pair. Use Cormorant Garamond only for large editorial moments (36sp and above, such as pull-quotes and the launch campaign), because its thin strokes break up on low-density screens below that size. Plus Jakarta Sans is the alternate if we want a friendlier, rounder UI voice in testing. **Don't ship all four in the app**, to keep the APK small.

**Delivery:**
- **Android:** fonts are **bundled** as subset variable TTFs (Latin and Latin Extended, so Yoruba, Igbo and Hausa diacritics like ẹ ọ ṣ ń ƙ ɗ ƴ render correctly). Don't use the `google_fonts` package's runtime download, because it costs members data and breaks when they're offline.
- **Web:** `next/font/google` with `display: swap`, self-hosted at build time.

### 3.2 Type scale (Material 3 roles)

| M3 role | Face | Size / line height (sp) | Weight | Use |
|---|---|---|---|---|
| `displayLarge` | Playfair Display | 48 / 56 | 600 | Welcome hero |
| `displaySmall` | Playfair Display | 36 / 44 | 600 | Celebration ("It's a match") |
| `headlineLarge` | Playfair Display | 32 / 40 | 600 | Screen titles in onboarding |
| `headlineMedium` | Playfair Display | 28 / 36 | 600 | Section titles |
| `headlineSmall` | Playfair Display | 24 / 32 | 500 | Profile name on cards |
| `titleLarge` | Inter | 22 / 28 | 600 | App bar titles |
| `titleMedium` | Inter | 16 / 24 | 600 | List headers, card titles |
| `bodyLarge` | Inter | 16 / 24 | 400 | Main body copy |
| `bodyMedium` | Inter | 14 / 20 | 400 | Secondary copy |
| `bodySmall` | Inter | 12 / 16 | 400 | Captions, legal text |
| `labelLarge` | Inter | 14 / 20 | 600 | Buttons |
| `labelMedium` | Inter | 12 / 16 | 600 | Chips, badges |

Rules:
- Playfair is for headlines only. **Never use it for body text, buttons, form fields or numbers in forms.**
- Use sentence case everywhere. No ALL CAPS, except tiny `labelMedium` overlines with +0.5 letter-spacing.
- Support system font scaling up to 200%. Layouts must reflow without clipping.

## 4. Shape, spacing & elevation

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 8dp | Inputs, chips |
| `radius-md` | 16dp | Cards, sheets |
| `radius-lg` | 28dp | Profile cards, hero media |
| `radius-full` | 999dp | Primary buttons (pill), avatars, the verified badge |
| Spacing scale | 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 dp | 4dp base grid |
| Screen gutter | 24dp | Onboarding. 16dp in dense lists |
| Min touch target | 48 × 48dp | Every interactive element |
| Elevation | Tonal (M3 surface tint), with soft shadows only on profile cards | No heavy drop shadows |

## 5. Iconography & imagery

- **Icons:** Material Symbols **Rounded**, weight 400, grade 0, outlined by default and filled when active.
- **Verified badge:** a rounded rosette with a check mark, gold `#D4AF37` with a night `#1A0B12` check (9.07:1). Its meaning is reserved: it only appears on members whose Smile ID verification passed.
- **Photography:** real, warm-toned photos of Nigerian adults, in daylight or golden hour. People are clothed and the mood is joyful. **Nothing sexualised, and nobody who looks under 25** in marketing (as an age-assurance safeguard).
- **Illustration:** simple line art in burgundy with gold highlights, for empty states and onboarding.

## 6. Motion

| Token | Value | Use |
|---|---|---|
| `motion-short` | 150ms, emphasized decelerate | Taps, toggles |
| `motion-medium` | 300ms, emphasized | Screen transitions, sheets |
| `motion-long` | 500ms, emphasized | The match celebration, verification success |

The tone is calm and graceful: no bouncy springs, and no confetti except a gentle gold shimmer on a match or on verification. Respect the system "Remove animations" setting.

## 7. Implementation

### 7.1 Flutter (`apps/mobile/lib/theme/amivara_rose.dart`, to be created in Stage 3)

```dart
const roseLight = ColorScheme(
  brightness: Brightness.light,
  primary: Color(0xFF88304E), onPrimary: Color(0xFFFFFFFF),
  primaryContainer: Color(0xFFF9DCE5), onPrimaryContainer: Color(0xFF3A0A1C),
  secondary: Color(0xFF52182F), onSecondary: Color(0xFFFFFFFF),
  tertiary: Color(0xFF8A6D12), onTertiary: Color(0xFFFFFFFF),
  surface: Color(0xFFFDFBF7), onSurface: Color(0xFF2A1A20),
  surfaceContainer: Color(0xFFF6F0E8), onSurfaceVariant: Color(0xFF6B5A60),
  outline: Color(0xFFE7DCD3),
  error: Color(0xFFB3261E), onError: Color(0xFFFFFFFF),
);

const roseDark = ColorScheme(
  brightness: Brightness.dark,
  primary: Color(0xFFE8A5BC), onPrimary: Color(0xFF1A0B12),
  primaryContainer: Color(0xFF6A2440), onPrimaryContainer: Color(0xFFFFD9E3),
  secondary: Color(0xFFE3BCC9), onSecondary: Color(0xFF2E0A18),
  tertiary: Color(0xFFD4AF37), onTertiary: Color(0xFF1A0B12),
  surface: Color(0xFF1A0B12), onSurface: Color(0xFFF5ECEF),
  surfaceContainer: Color(0xFF2A1520), onSurfaceVariant: Color(0xFFBFAEB4),
  outline: Color(0xFF3D2430),
  error: Color(0xFFF2B8B5), onError: Color(0xFF601410),
);

// Brand-only tokens that sit outside the M3 roles
abstract final class RoseBrand {
  static const champagneGold = Color(0xFFD4AF37);
  static const burgundy      = Color(0xFF52182F);
  static const deepRose      = Color(0xFF88304E);
}
```

### 7.2 Web (CSS custom properties)

```css
:root {
  --am-primary: #88304E;  --am-on-primary: #FFFFFF;
  --am-secondary: #52182F;
  --am-accent: #D4AF37;   --am-accent-text: #8A6D12;
  --am-bg: #FDFBF7;       --am-surface: #F6F0E8;
  --am-text: #2A1A20;     --am-text-muted: #6B5A60;
  --am-line: #E7DCD3;
  --am-font-display: "Playfair Display", Georgia, serif;
  --am-font-body: "Inter", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --am-primary: #E8A5BC;  --am-on-primary: #1A0B12;
    --am-secondary: #E3BCC9;
    --am-accent: #D4AF37;   --am-accent-text: #D4AF37;
    --am-bg: #1A0B12;       --am-surface: #2A1520;
    --am-text: #F5ECEF;     --am-text-muted: #BFAEB4;
    --am-line: #3D2430;
  }
}
```

The canonical tokens live in [`tokens.json`](tokens.json) (W3C Design Tokens format). It is the single source for both platforms, and the snippets above will be generated from it in Stage 3.

## 8. Logo (summary; the full brief is in `design/logos/LOGO_BRIEF.md`)

- Wordmark: "AMIVARA" in Playfair Display SemiBold with custom letter-spacing, burgundy on ivory or ivory on burgundy.
- Monogram: a stylised **A** formed by two curves meeting (mutual connection), with a small gold point at the apex.
- The minimum clear space around the logo is the height of the "A".
- App icon: the monogram in ivory with a gold apex point on a **Burgundy `#52182F`** background (**confirmed by the founder**. It replaces Deep Rose, because gold on rose isn't allowed). Full spec in [`design/logos/LOGO_BRIEF.md`](../logos/LOGO_BRIEF.md).
