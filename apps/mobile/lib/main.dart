import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'features/onboarding/welcome_screen.dart';
import 'theme/amivara_theme.dart';

void main() {
  registerFontLicenses();
  runApp(const AmivaraApp());
}

/// The bundled fonts are licensed under the SIL OFL 1.1, which requires the
/// licence to ship with them. This shows them on Flutter's licence page.
void registerFontLicenses() {
  LicenseRegistry.addLicense(() async* {
    for (final (family, file) in const [('Playfair', 'OFL-Playfair.txt'), ('Inter', 'OFL-Inter.txt')]) {
      final text = await rootBundle.loadString('assets/fonts/$file');
      yield LicenseEntryWithLineBreaks(<String>[family], text);
    }
  });
}

class AmivaraApp extends StatelessWidget {
  const AmivaraApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AMIVARA',
      debugShowCheckedModeBanner: false,
      theme: AmivaraTheme.light(),
      darkTheme: AmivaraTheme.dark(),
      themeMode: ThemeMode.system,
      home: const WelcomeScreen(),
    );
  }
}
