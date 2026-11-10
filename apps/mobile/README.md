# AMIVARA mobile (Flutter, Android)

Android-only for the MVP: `com.amivara.app`, minSdk 24 (Android 7.0), portrait only. iOS follows after launch.

```sh
flutter pub get
flutter analyze
flutter test
flutter run                         # device or emulator
flutter build appbundle --release   # debug-signed until Play App Signing is set up
```

- **Theme:** `lib/theme/amivara_theme.dart` builds the AMIVARA ROSE Material 3 theme from `lib/theme/rose_tokens.g.dart`.
- **Generated tokens:** don't edit `rose_tokens.g.dart` by hand. Edit `design/brand/tokens.json` and run `pnpm tokens` from the repo root.
- **Dynamic colour (Material You):** deliberately off.
- **Specs:** [UI_WIREFRAMES.md](../../docs/UI_WIREFRAMES.md) · [AMIVARA_ROSE.md](../../design/brand/AMIVARA_ROSE.md) · [LOGO_BRIEF.md](../../design/logos/LOGO_BRIEF.md)
