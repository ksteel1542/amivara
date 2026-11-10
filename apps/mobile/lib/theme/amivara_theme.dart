import 'package:flutter/material.dart';

import 'rose_tokens.g.dart';

/// AMIVARA ROSE Material 3 theme, built from the generated design tokens.
///
/// Brand fonts (Playfair for headlines, Inter for UI) are bundled under
/// `assets/fonts/` and declared in pubspec.yaml, so they work offline and
/// cover every Yoruba, Igbo and Hausa letter and ₦ (AMIVARA_ROSE.md §3.1).
abstract final class AmivaraTheme {
  static ThemeData light() => _build(RoseSchemes.light);

  static ThemeData dark() => _build(RoseSchemes.dark);

  static ThemeData _build(ColorScheme scheme) {
    final textTheme = _textTheme().apply(bodyColor: scheme.onSurface, displayColor: scheme.onSurface);

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      textTheme: textTheme,
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(RoseSpacing.buttonPrimaryHeight),
          shape: const StadiumBorder(),
          textStyle: RoseType.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(minimumSize: const Size(48, 48), textStyle: RoseType.labelLarge),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(RoseRadius.sm)),
      ),
      cardTheme: CardThemeData(
        color: scheme.surfaceContainer,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(RoseRadius.md)),
      ),
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: <TargetPlatform, PageTransitionsBuilder>{
          TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
        },
      ),
    );
  }

  static TextTheme _textTheme() => const TextTheme(
    displayLarge: RoseType.displayLarge,
    displaySmall: RoseType.displaySmall,
    headlineLarge: RoseType.headlineLarge,
    headlineMedium: RoseType.headlineMedium,
    headlineSmall: RoseType.headlineSmall,
    titleLarge: RoseType.titleLarge,
    titleMedium: RoseType.titleMedium,
    bodyLarge: RoseType.bodyLarge,
    bodyMedium: RoseType.bodyMedium,
    bodySmall: RoseType.bodySmall,
    labelLarge: RoseType.labelLarge,
    labelMedium: RoseType.labelMedium,
  );
}
