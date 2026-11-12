import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/api_client.dart';
import 'package:amivara/core/secure_store.dart';
import 'package:amivara/features/auth/auth_providers.dart';
import 'package:amivara/features/discovery/discovery_providers.dart';
import 'package:amivara/features/home/home_screen.dart';
import 'package:amivara/features/profile/photo_processor.dart';
import 'package:amivara/features/profile/profile_providers.dart';
import 'package:amivara/features/safety/safety_repository.dart';
import 'package:amivara/features/settings/settings_repository.dart';
import 'package:amivara/features/settings/settings_screen.dart';
import 'package:amivara/features/verification/verification_providers.dart';
import 'package:amivara/main.dart';

import 'support/fakes.dart';

/// Signed in, opened on Settings & Privacy from the home app bar.
Future<ProviderContainer> pumpSettings(
  WidgetTester tester, {
  FakeSettingsRepository? settings,
  FakeDataSaver? saver,
  FakeSafetyRepository? safety,
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);

  final container = ProviderContainer(
    overrides: [
      authRepositoryProvider.overrideWithValue(FakeAuthRepository()..verified = true),
      secureStoreProvider.overrideWithValue(MemoryStore()),
      profileRepositoryProvider.overrideWithValue(FakeProfileRepository()),
      photoProcessorProvider.overrideWithValue(FakePhotoProcessor() as PhotoProcessor),
      verificationRepositoryProvider.overrideWithValue(FakeVerificationRepository()),
      identityCaptureProvider.overrideWithValue(FakeIdentityCapture()),
      discoveryRepositoryProvider.overrideWithValue(FakeDiscoveryRepository()),
      locationSourceProvider.overrideWithValue(FakeLocationSource()),
      cardImageBuilderProvider.overrideWithValue(placeholderImage),
      settingsRepositoryProvider.overrideWithValue(settings ?? FakeSettingsRepository()),
      dataSaverProvider.overrideWithValue(saver ?? FakeDataSaver()),
      safetyRepositoryProvider.overrideWithValue(safety ?? FakeSafetyRepository()),
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
  expect(find.byType(SettingsScreen), findsOneWidget);
  return container;
}

/// Settings is a lazy ListView: scroll a row fully into view before tapping it.
Future<void> revealSetting(WidgetTester tester, String key) async {
  final scrollable = find.descendant(of: find.byKey(const Key('settings-list')), matching: find.byType(Scrollable));
  await tester.scrollUntilVisible(find.byKey(Key(key)), 150, scrollable: scrollable.first);
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

bool switchValue(WidgetTester tester, String key) => tester.widget<SwitchListTile>(find.byKey(Key(key))).value;

Future<void> openDeleteDialog(WidgetTester tester) async {
  await revealSetting(tester, 'delete-account');
  await tester.tap(find.byKey(const Key('delete-account')));
  await tester.pumpAndSettle();
  expect(find.byKey(const Key('delete-dialog')), findsOneWidget);
}

void main() {
  testWidgets('pause toggle hides me from discovery and can be undone', (tester) async {
    final repo = FakeSettingsRepository();
    await pumpSettings(tester, settings: repo);
    expect(switchValue(tester, 'pause-switch'), isFalse);

    await tester.tap(find.byKey(const Key('pause-switch')));
    await tester.pumpAndSettle();
    expect(repo.calls, ['update:true:-']);
    expect(switchValue(tester, 'pause-switch'), isTrue);
    expect(find.textContaining("You're paused"), findsOneWidget);

    await tester.tap(find.byKey(const Key('pause-switch')));
    await tester.pumpAndSettle();
    expect(repo.calls.last, 'update:false:-');
    expect(switchValue(tester, 'pause-switch'), isFalse);
  });

  testWidgets('incognito toggle, and a refusal leaves it off with the reason', (tester) async {
    final repo = FakeSettingsRepository()
      ..updateError = const ApiException(403, 'VERIFICATION_REQUIRED', 'Verify your identity to use incognito.');
    await pumpSettings(tester, settings: repo);
    await tester.tap(find.byKey(const Key('incognito-switch')));
    await tester.pumpAndSettle();
    expect(repo.calls, ['update:-:true']);
    expect(switchValue(tester, 'incognito-switch'), isFalse);
    expect(find.text('Verify your identity to use incognito.'), findsOneWidget);

    repo.updateError = null;
    await tester.tap(find.byKey(const Key('incognito-switch')));
    await tester.pumpAndSettle();
    expect(switchValue(tester, 'incognito-switch'), isTrue);
  });

  testWidgets('lists devices and signs one out with a single tap', (tester) async {
    final repo = FakeSettingsRepository();
    await pumpSettings(tester, settings: repo);
    expect(find.text('Tecno Spark 20'), findsOneWidget);
    expect(find.text('This device'), findsOneWidget);
    expect(find.byKey(const Key('revoke-s-me')), findsNothing); // can't revoke the current one here
    expect(find.text('Infinix Hot 40'), findsOneWidget);
    expect(find.text('Last active 3 days ago'), findsOneWidget);

    await tester.tap(find.byKey(const Key('revoke-s-old')));
    await tester.pumpAndSettle();
    expect(repo.calls, ['revoke:s-old']);
    expect(find.byKey(const Key('session-s-old')), findsNothing);
    expect(find.text('Infinix Hot 40 signed out.'), findsOneWidget);
  });

  testWidgets('signs out all other devices', (tester) async {
    final now = DateTime.now();
    final repo = FakeSettingsRepository(
      sessions: [
        DeviceSession(id: 'me', current: true, lastUsedAt: now, platform: 'android'),
        DeviceSession(id: 'a', current: false, lastUsedAt: now, platform: 'android'),
        DeviceSession(id: 'b', current: false, lastUsedAt: now, platform: 'web'),
      ],
    );
    await pumpSettings(tester, settings: repo);
    await revealSetting(tester, 'revoke-others');
    await tester.tap(find.byKey(const Key('revoke-others')));
    await tester.pumpAndSettle();
    expect(repo.calls, ['revoke-others']);
    expect(find.byKey(const Key('session-a')), findsNothing);
    expect(find.byKey(const Key('session-b')), findsNothing);
    expect(find.byKey(const Key('session-me')), findsOneWidget);
    expect(find.text('Signed out 2 other devices.'), findsOneWidget);
  });

  testWidgets('Download my data hands the JSON to the share sheet', (tester) async {
    final repo = FakeSettingsRepository();
    final saver = FakeDataSaver();
    await pumpSettings(tester, settings: repo, saver: saver);
    await revealSetting(tester, 'export-button');
    await tester.tap(find.byKey(const Key('export-button')));
    await tester.pumpAndSettle();
    expect(repo.calls, ['export']);
    expect(
      saver.saved.single,
      matches(RegExp(r'^amivara-data-\d{4}-\d{2}-\d{2}\.json:\{"format": "amivara-export/1"\}$')),
    );
  });

  testWidgets('delete needs DELETE typed; cancelling changes nothing', (tester) async {
    final repo = FakeSettingsRepository();
    await pumpSettings(tester, settings: repo);
    await openDeleteDialog(tester);

    FilledButton confirm() => tester.widget<FilledButton>(find.byKey(const Key('delete-confirm')));
    expect(confirm().onPressed, isNull);
    await tester.enterText(find.byKey(const Key('delete-confirm-field')), 'delet');
    await tester.pump();
    expect(confirm().onPressed, isNull);
    await tester.enterText(find.byKey(const Key('delete-confirm-field')), 'delete');
    await tester.pump();
    expect(confirm().onPressed, isNotNull); // case doesn't matter

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('delete-dialog')), findsNothing);
    expect(repo.calls, isEmpty);
    expect(find.byType(SettingsScreen), findsOneWidget);
  });

  testWidgets('deleting signs out and returns to the welcome screen', (tester) async {
    final repo = FakeSettingsRepository();
    final container = await pumpSettings(tester, settings: repo);
    await openDeleteDialog(tester);
    await tester.enterText(find.byKey(const Key('delete-confirm-field')), 'DELETE');
    await tester.pump();
    await tester.tap(find.byKey(const Key('delete-confirm')));
    await tester.pumpAndSettle();

    expect(repo.calls, ['delete']);
    expect(container.read(sessionProvider), isNull);
    expect(find.byType(SettingsScreen), findsNothing);
    expect(find.byType(HomeScreen), findsNothing);
    expect(find.textContaining('It will be erased on 10/12/2026'), findsOneWidget);
  });

  testWidgets('sign out lives in settings now', (tester) async {
    final container = await pumpSettings(tester);
    await revealSetting(tester, 'sign-out');
    await tester.tap(find.byKey(const Key('sign-out')));
    await tester.pumpAndSettle();
    expect(container.read(sessionProvider), isNull);
    expect(find.byType(SettingsScreen), findsNothing);
  });
}
