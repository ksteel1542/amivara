import 'package:flutter/material.dart';

import 'rose_tokens.g.dart';

/// AMIVARA ROSE Material 3 theme, built from the generated design tokens.
///
/// Brand fonts (Playfair Display, Inter) are referenced by family name. Until
/// the subset font files are bundled under `assets/fonts/` (see
/// AMIVARA_ROSE.md §3.1), Flutter falls back to the platform font (Roboto).
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
