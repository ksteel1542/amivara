import 'package:flutter/material.dart';

import 'features/onboarding/welcome_screen.dart';
import 'theme/amivara_theme.dart';

void main() {
  runApp(const AmivaraApp());
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
