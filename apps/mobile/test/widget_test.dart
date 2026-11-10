import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/secure_store.dart';
import 'package:amivara/features/auth/auth_providers.dart';
import 'package:amivara/main.dart';
import 'package:amivara/theme/amivara_theme.dart';
import 'package:amivara/theme/rose_tokens.g.dart';

import 'support/fakes.dart';

/// The 360 x 800dp Android reference frame from docs/UI_WIREFRAMES.md.
void _usePhoneFrame(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2400); // 360 x 800dp at 3x
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
}

Widget _app() => ProviderScope(
  overrides: [
    authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
    secureStoreProvider.overrideWithValue(MemoryStore()),
  ],
  child: const AmivaraApp(),
);

void main() {
  testWidgets('Welcome screen shows the brand promise and both CTAs', (tester) async {
    _usePhoneFrame(tester);
    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();

    expect(find.text('AMIVARA'), findsOneWidget);
    expect(find.text('Real connections between verified adults.'), findsOneWidget);
    expect(find.text('Create account'), findsOneWidget);
    expect(find.text('I already have an account'), findsOneWidget);
  });

  testWidgets('Welcome screen reflows at 200% font scale without overflow', (tester) async {
    _usePhoneFrame(tester);
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();

    // A RenderFlex overflow would be reported as an exception here.
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(find.text('I already have an account'), 200);
    expect(find.text('I already have an account'), findsOneWidget);
  });

  test('Theme uses the AMIVARA ROSE schemes and never dynamic colour', () {
    expect(AmivaraTheme.light().colorScheme.primary, RoseColors.deepRose);
    expect(AmivaraTheme.light().colorScheme.surface, RoseColors.warmIvory);
    // Deep Rose fails contrast on the dark canvas; dark mode must use rose-300.
    expect(AmivaraTheme.dark().colorScheme.primary, RoseColors.rose300);
    expect(AmivaraTheme.dark().colorScheme.surface, RoseColors.burgundyBlack);
  });
}
