// GENERATED FILE. Do not edit by hand. Source: design/brand/tokens.json. Regenerate with `pnpm tokens`.
// ignore_for_file: public_member_api_docs

import 'package:flutter/material.dart';

/// Raw AMIVARA ROSE colours. Prefer [RoseSchemes] roles in widgets.
abstract final class RoseColors {
  static const Color deepRose = Color(0xFF88304E);
  static const Color burgundy = Color(0xFF52182F);
  static const Color champagneGold = Color(0xFFD4AF37);
  static const Color warmIvory = Color(0xFFFDFBF7);
  static const Color burgundyBlack = Color(0xFF1A0B12);
  static const Color rose100 = Color(0xFFF9DCE5);
  static const Color rose300 = Color(0xFFE8A5BC);
  static const Color rose700 = Color(0xFF88304E);
  static const Color rose800 = Color(0xFF6A2440);
  static const Color rose950 = Color(0xFF3A0A1C);
  static const Color burgundy200 = Color(0xFFE3BCC9);
  static const Color burgundy900 = Color(0xFF52182F);
  static const Color burgundy950 = Color(0xFF2E0A18);
  static const Color gold500 = Color(0xFFD4AF37);
  static const Color gold700 = Color(0xFF8A6D12);
  static const Color ivory50 = Color(0xFFFDFBF7);
  static const Color ivory100 = Color(0xFFF6F0E8);
  static const Color night800 = Color(0xFF2A1520);
  static const Color night950 = Color(0xFF1A0B12);
  static const Color ink600 = Color(0xFF6B5A60);
  static const Color ink900 = Color(0xFF2A1A20);
  static const Color mist50 = Color(0xFFF5ECEF);
  static const Color mist300 = Color(0xFFBFAEB4);
  static const Color lineLight = Color(0xFFE7DCD3);
  static const Color lineDark = Color(0xFF3D2430);
  static const Color white = Color(0xFFFFFFFF);
  static const Color statusSuccessLight = Color(0xFF2E7D5B);
  static const Color statusSuccessDark = Color(0xFF7FD1AE);
  static const Color statusWarningLight = Color(0xFF965C09);
  static const Color statusWarningDark = Color(0xFFF2C46D);
  static const Color statusErrorLight = Color(0xFFB3261E);
  static const Color statusErrorDark = Color(0xFFF2B8B5);
  static const Color statusErrorOnDark = Color(0xFF601410);
  static const Color brandVerifiedBadgeFill = Color(0xFFD4AF37);
  static const Color brandVerifiedBadgeCheck = Color(0xFF1A0B12);
  static const Color brandHeroBackground = Color(0xFF52182F);
}

/// Material 3 colour schemes. Dynamic colour (Material You) is deliberately not used.
abstract final class RoseSchemes {
  static const ColorScheme light = ColorScheme(
    brightness: Brightness.light,
    primary: Color(0xFF88304E),
    onPrimary: Color(0xFFFFFFFF),
    primaryContainer: Color(0xFFF9DCE5),
    onPrimaryContainer: Color(0xFF3A0A1C),
    secondary: Color(0xFF52182F),
    onSecondary: Color(0xFFFFFFFF),
    tertiary: Color(0xFF8A6D12),
    onTertiary: Color(0xFFFFFFFF),
    surface: Color(0xFFFDFBF7),
    onSurface: Color(0xFF2A1A20),
    surfaceContainer: Color(0xFFF6F0E8),
    onSurfaceVariant: Color(0xFF6B5A60),
    outline: Color(0xFFE7DCD3),
    error: Color(0xFFB3261E),
    onError: Color(0xFFFFFFFF),
  );
  static const ColorScheme dark = ColorScheme(
    brightness: Brightness.dark,
    primary: Color(0xFFE8A5BC),
    onPrimary: Color(0xFF1A0B12),
    primaryContainer: Color(0xFF6A2440),
    onPrimaryContainer: Color(0xFFFFD9E3),
    secondary: Color(0xFFE3BCC9),
    onSecondary: Color(0xFF2E0A18),
    tertiary: Color(0xFFD4AF37),
    onTertiary: Color(0xFF1A0B12),
    surface: Color(0xFF1A0B12),
    onSurface: Color(0xFFF5ECEF),
    surfaceContainer: Color(0xFF2A1520),
    onSurfaceVariant: Color(0xFFBFAEB4),
    outline: Color(0xFF3D2430),
    error: Color(0xFFF2B8B5),
    onError: Color(0xFF601410),
  );
}

/// Spacing scale in logical pixels (dp), 4dp grid.
abstract final class RoseSpacing {
  static const double s1 = 4.0;
  static const double s2 = 8.0;
  static const double s3 = 12.0;
  static const double s4 = 16.0;
  static const double s6 = 24.0;
  static const double s8 = 32.0;
  static const double s12 = 48.0;
  static const double s16 = 64.0;
  static const double gutterOnboarding = 24.0;
  static const double gutterDense = 16.0;
  static const double buttonPrimaryHeight = 56.0;
  static const double buttonBottomInset = 24.0;
}

/// Corner radii in logical pixels (dp).
abstract final class RoseRadius {
  static const double sm = 8.0;
  static const double md = 16.0;
  static const double lg = 28.0;
  static const double full = 999.0;
}

/// Motion durations and easing curves.
abstract final class RoseMotion {
  static const Duration short = Duration(milliseconds: 150);
  static const Duration medium = Duration(milliseconds: 300);
  static const Duration long = Duration(milliseconds: 500);
  static const Cubic emphasized = Cubic(0.2, 0.0, 0.0, 1.0);
  static const Cubic emphasizedDecelerate = Cubic(0.05, 0.7, 0.1, 1.0);
  static const Cubic emphasizedAccelerate = Cubic(0.3, 0.0, 0.8, 0.15);
}

/// Font families. The first entry is the brand face; the rest are fallbacks.
abstract final class RoseFonts {
  static const String display = 'Playfair Display';
  static const List<String> displayFallback = <String>[];
  static const String displayAlternate = 'Cormorant Garamond';
  static const List<String> displayAlternateFallback = <String>[];
  static const String body = 'Inter';
  static const List<String> bodyFallback = <String>['Roboto'];
  static const String bodyAlternate = 'Plus Jakarta Sans';
  static const List<String> bodyAlternateFallback = <String>['Roboto'];
}

/// Material 3 type roles. letterSpacing tokens are in em and are converted to dp here.
abstract final class RoseType {
  static const TextStyle displayLarge = TextStyle(
    fontFamily: 'Playfair Display',
    fontFamilyFallback: <String>[],
    fontSize: 48.0,
    height: 1.1667,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.0,
  );
  static const TextStyle displaySmall = TextStyle(
    fontFamily: 'Playfair Display',
    fontFamilyFallback: <String>[],
    fontSize: 36.0,
    height: 1.2222,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.0,
  );
  static const TextStyle headlineLarge = TextStyle(
    fontFamily: 'Playfair Display',
    fontFamilyFallback: <String>[],
    fontSize: 32.0,
    height: 1.25,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.0,
  );
  static const TextStyle headlineMedium = TextStyle(
    fontFamily: 'Playfair Display',
    fontFamilyFallback: <String>[],
    fontSize: 28.0,
    height: 1.2857,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.0,
  );
  static const TextStyle headlineSmall = TextStyle(
    fontFamily: 'Playfair Display',
    fontFamilyFallback: <String>[],
    fontSize: 24.0,
    height: 1.3333,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.0,
  );
  static const TextStyle titleLarge = TextStyle(
    fontFamily: 'Inter',
    fontFamilyFallback: <String>['Roboto'],
    fontSize: 22.0,
    height: 1.2727,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.0,
  );
  static const TextStyle titleMedium = TextStyle(
    fontFamily: 'Inter',
    fontFamilyFallback: <String>['Roboto'],
    fontSize: 16.0,
    height: 1.5,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.15,
  );
  static const TextStyle bodyLarge = TextStyle(
    fontFamily: 'Inter',
    fontFamilyFallback: <String>['Roboto'],
    fontSize: 16.0,
    height: 1.5,
    fontWeight: FontWeight.w400,
    letterSpacing: 0.5,
  );
  static const TextStyle bodyMedium = TextStyle(
    fontFamily: 'Inter',
    fontFamilyFallback: <String>['Roboto'],
    fontSize: 14.0,
    height: 1.4286,
    fontWeight: FontWeight.w400,
    letterSpacing: 0.21875,
  );
  static const TextStyle bodySmall = TextStyle(
    fontFamily: 'Inter',
    fontFamilyFallback: <String>['Roboto'],
    fontSize: 12.0,
    height: 1.3333,
    fontWeight: FontWeight.w400,
    letterSpacing: 0.3,
  );
  static const TextStyle labelLarge = TextStyle(
    fontFamily: 'Inter',
    fontFamilyFallback: <String>['Roboto'],
    fontSize: 14.0,
    height: 1.4286,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.0875,
  );
  static const TextStyle labelMedium = TextStyle(
    fontFamily: 'Inter',
    fontFamilyFallback: <String>['Roboto'],
    fontSize: 12.0,
    height: 1.3333,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.375,
  );
}
