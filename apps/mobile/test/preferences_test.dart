import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/api_client.dart';
import 'package:amivara/core/secure_store.dart';
import 'package:amivara/features/auth/auth_providers.dart';
import 'package:amivara/features/discovery/discovery_providers.dart';
import 'package:amivara/features/home/home_screen.dart';
import 'package:amivara/features/preferences/preferences_repository.dart';
import 'package:amivara/features/preferences/preferences_screen.dart';
import 'package:amivara/features/profile/photo_processor.dart';
import 'package:amivara/features/profile/profile_providers.dart';
import 'package:amivara/features/settings/settings_repository.dart';
import 'package:amivara/features/verification/verification_providers.dart';
import 'package:amivara/main.dart';

import 'support/fakes.dart';

/// Signed in, then Settings & Privacy → Discovery preferences.
Future<void> pumpPreferences(
  WidgetTester tester, {
  required FakePreferencesRepository prefs,
  required FakeProfileRepository profiles,
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);

  final container = ProviderContainer(
    overrides: [
      authRepositoryProvider.overrideWithValue(FakeAuthRepository()..verified = true),
      secureStoreProvider.overrideWithValue(MemoryStore()),
      profileRepositoryProvider.overrideWithValue(profiles),
      photoProcessorProvider.overrideWithValue(FakePhotoProcessor() as PhotoProcessor),
      verificationRepositoryProvider.overrideWithValue(FakeVerificationRepository()),
      identityCaptureProvider.overrideWithValue(FakeIdentityCapture()),
      discoveryRepositoryProvider.overrideWithValue(FakeDiscoveryRepository()),
      locationSourceProvider.overrideWithValue(FakeLocationSource()),
      cardImageBuilderProvider.overrideWithValue(placeholderImage),
      settingsRepositoryProvider.overrideWithValue(FakeSettingsRepository()),
      dataSaverProvider.overrideWithValue(FakeDataSaver()),
      preferencesRepositoryProvider.overrideWithValue(prefs),
    ],
  );
  addTearDown(container.dispose);
  await container.read(sessionProvider.notifier).signIn(kTokens);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const AmivaraApp(initialLocation: '/home'),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('settings-button')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('preferences-tile')));
  await tester.pumpAndSettle();
  expect(find.byType(PreferencesScreen), findsOneWidget);
}

/// The screen is a lazy ListView: rows below the fold aren't built until scrolled to.
Future<void> reveal(WidgetTester tester, String key) async {
  final scrollable = find.descendant(of: find.byKey(const Key('preferences-list')), matching: find.byType(Scrollable));
  await tester.scrollUntilVisible(find.byKey(Key(key)), 200, scrollable: scrollable.first);
  await tester.pumpAndSettle();
}

Future<void> tapKey(WidgetTester tester, String key) async {
  await reveal(tester, key);
  await tester.tap(find.byKey(Key(key)));
  await tester.pump();
}

Future<bool> chipSelected(WidgetTester tester, String key) async {
  await reveal(tester, key);
  return tester.widget<FilterChip>(find.byKey(Key(key))).selected;
}

void main() {
  testWidgets('loads the current preferences, interests and languages', (tester) async {
    final profiles = FakeProfileRepository()
      ..interests = <String>['football']
      ..languages = <String>['en'];
    await pumpPreferences(tester, prefs: FakePreferencesRepository(), profiles: profiles);

    expect(await chipSelected(tester, 'seek-man'), isTrue);
    expect(await chipSelected(tester, 'seek-woman'), isFalse);
    expect(find.text('22–32'), findsOneWidget);
    expect(find.text('50 km'), findsOneWidget);
    await reveal(tester, 'age-range');
    final range = tester.widget<RangeSlider>(find.byKey(const Key('age-range')));
    expect(range.min, 18); // nobody can look below 18
    expect(range.values, const RangeValues(22, 32));
    expect(await chipSelected(tester, 'interest-football'), isTrue);
    expect(await chipSelected(tester, 'language-en'), isTrue);
    expect(find.text('Yorùbá'), findsOneWidget);
  });

  testWidgets('saves gender, age, distance, interests and languages', (tester) async {
    final prefs = FakePreferencesRepository();
    final profiles = FakeProfileRepository();
    await pumpPreferences(tester, prefs: prefs, profiles: profiles);

    await tapKey(tester, 'seek-woman');
    // Drag the age range's upper thumb and the distance slider to their maximums.
    await reveal(tester, 'age-range');
    final range = tester.getRect(find.byKey(const Key('age-range')));
    await tester.dragFrom(Offset(range.left + range.width * 0.18, range.center.dy), Offset(range.width, 0));
    await tester.pumpAndSettle();
    await reveal(tester, 'distance');
    final distance = tester.getRect(find.byKey(const Key('distance')));
    await tester.dragFrom(distance.center, Offset(distance.width, 0));
    await tester.pumpAndSettle();
    await tapKey(tester, 'interest-afrobeats');
    await tapKey(tester, 'interest-owambe');
    await tapKey(tester, 'language-yo');
    await tapKey(tester, 'save-preferences');
    await tester.pumpAndSettle();

    expect(prefs.calls, hasLength(1));
    expect(prefs.prefs.interestedIn, <SeekGender>{SeekGender.man, SeekGender.woman});
    expect(prefs.prefs.ageMin, 22);
    expect(prefs.prefs.ageMax, 99);
    expect(prefs.prefs.maxDistanceKm, 300);
    expect(profiles.calls, contains('updateTags:afrobeats,owambe|yo'));
    expect(find.byType(PreferencesScreen), findsNothing); // back to Settings
    expect(find.text('Preferences saved. Discovery will use them right away.'), findsOneWidget);
  });

  testWidgets('must show at least one gender', (tester) async {
    await pumpPreferences(tester, prefs: FakePreferencesRepository(), profiles: FakeProfileRepository());
    await tapKey(tester, 'seek-man'); // deselect the only one
    expect(find.byKey(const Key('seek-error')), findsOneWidget);
    await reveal(tester, 'save-preferences');
    expect(tester.widget<FilledButton>(find.byKey(const Key('save-preferences'))).onPressed, isNull);
  });

  testWidgets('caps interests and languages at the catalogue limits', (tester) async {
    final profiles = FakeProfileRepository();
    await pumpPreferences(tester, prefs: FakePreferencesRepository(), profiles: profiles);
    // The fake catalogue allows 3 interests and 2 languages.
    for (final id in <String>['afrobeats', 'amapiano', 'football', 'cooking']) {
      await tapKey(tester, 'interest-$id');
    }
    expect(await chipSelected(tester, 'interest-cooking'), isFalse);
    expect(find.text('You can choose up to 3 interests.'), findsOneWidget);
    for (final code in <String>['en', 'pcm', 'yo']) {
      await tapKey(tester, 'language-$code');
    }
    expect(await chipSelected(tester, 'language-yo'), isFalse);
    // Tapping a chosen one removes it.
    await tapKey(tester, 'interest-afrobeats');
    expect(await chipSelected(tester, 'interest-afrobeats'), isFalse);
  });

  testWidgets('a rejected save keeps the screen open with the reason', (tester) async {
    final prefs = FakePreferencesRepository()
      ..updateError = const ApiException(400, 'VALIDATION_FAILED', 'The youngest age must not be above the oldest.');
    await pumpPreferences(tester, prefs: prefs, profiles: FakeProfileRepository());
    await tapKey(tester, 'save-preferences');
    await tester.pumpAndSettle();
    expect(find.byType(PreferencesScreen), findsOneWidget);
    expect(find.text('The youngest age must not be above the oldest.'), findsOneWidget);
  });
}
