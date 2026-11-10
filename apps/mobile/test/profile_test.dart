import 'dart:typed_data';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:amivara/core/secure_store.dart';
import 'package:amivara/features/auth/auth_providers.dart';
import 'package:amivara/features/auth/auth_repository.dart';
import 'package:amivara/features/profile/photo_grid.dart';
import 'package:amivara/features/profile/photo_processor.dart';
import 'package:amivara/features/profile/profile_editor_screen.dart';
import 'package:amivara/features/profile/profile_models.dart';
import 'package:amivara/features/profile/profile_providers.dart';
import 'package:amivara/features/verification/verify_intro_screen.dart';
import 'package:amivara/theme/amivara_theme.dart';

import 'support/fakes.dart';

Widget _testImage(BuildContext context, ProfilePhoto p) => ColoredBox(
  color: Colors.brown,
  child: Center(child: Text(p.id)),
);

/// Signed-in shell with a router, so screens can navigate.
Future<void> pumpSignedIn(
  WidgetTester tester, {
  required Widget Function() screen,
  FakeProfileRepository? profiles,
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);

  final router = GoRouter(
    initialLocation: '/screen',
    routes: <RouteBase>[
      GoRoute(path: '/screen', builder: (_, _) => screen()),
      GoRoute(
        path: '/verify-intro',
        builder: (_, _) => const Scaffold(body: Text('VERIFY INTRO')),
      ),
      GoRoute(
        path: '/home',
        builder: (_, _) => const Scaffold(body: Text('HOME')),
      ),
    ],
  );
  addTearDown(router.dispose);

  final container = ProviderContainer(
    overrides: [
      authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
      secureStoreProvider.overrideWithValue(MemoryStore()),
      profileRepositoryProvider.overrideWithValue(profiles ?? FakeProfileRepository()),
      photoProcessorProvider.overrideWithValue(FakePhotoProcessor()),
    ],
  );
  addTearDown(container.dispose);
  await container.read(sessionProvider.notifier).signIn(kTokens);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(theme: AmivaraTheme.light(), routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
}

/// Long-press a photo, drag it onto another slot, release.
Future<void> dragPhoto(WidgetTester tester, {required int from, required int to}) async {
  final start = tester.getCenter(find.byKey(Key('photo-slot-$from')));
  final end = tester.getCenter(find.byKey(Key('photo-slot-$to')));
  final gesture = await tester.startGesture(start);
  await tester.pump(kLongPressTimeout + const Duration(milliseconds: 100));
  await gesture.moveTo(end, timeStamp: const Duration(milliseconds: 50));
  await tester.pump(const Duration(milliseconds: 100));
  await gesture.up();
  await tester.pumpAndSettle();
}

void main() {
  group('PhotoGrid', () {
    Future<List<String>?> pumpGrid(WidgetTester tester, List<ProfilePhoto> photos) async {
      List<String>? reordered;
      await tester.pumpWidget(
        MaterialApp(
          theme: AmivaraTheme.light(),
          home: Scaffold(
            body: SizedBox(
              width: 360,
              child: PhotoGrid(
                photos: photos,
                onReorder: (ids) => reordered = ids,
                onAdd: () {},
                onPhotoTap: (_) {},
                imageBuilder: _testImage,
              ),
            ),
          ),
        ),
      );
      await dragPhoto(tester, from: 0, to: 2);
      return reordered;
    }

    testWidgets('dragging a photo onto another slot moves it there', (tester) async {
      final result = await pumpGrid(tester, <ProfilePhoto>[photo('a', primary: true), photo('b'), photo('c')]);
      expect(result, <String>['b', 'c', 'a']);
    });

    testWidgets('shows the Main badge on slot 1, an add tile next, then empty slots', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AmivaraTheme.light(),
          home: Scaffold(
            body: PhotoGrid(
              photos: <ProfilePhoto>[photo('a', primary: true), photo('b')],
              onReorder: (_) {},
              onAdd: () {},
              onPhotoTap: (_) {},
              imageBuilder: _testImage,
            ),
          ),
        ),
      );
      expect(find.text('Main'), findsOneWidget);
      expect(find.bySemanticsLabel('Add a photo'), findsOneWidget);
      expect(find.byKey(const Key('photo-slot-5')), findsOneWidget);
    });
  });

  group('Profile editor', () {
    testWidgets('reordering by drag updates the grid and the API', (tester) async {
      final profiles = FakeProfileRepository(photoIds: <String>['p1', 'p2', 'p3']);
      await pumpSignedIn(
        tester,
        profiles: profiles,
        screen: () => const ProfileEditorScreen(imageBuilder: _testImage),
      );

      await dragPhoto(tester, from: 2, to: 0);

      expect(profiles.calls, contains('reorder:p3,p1,p2'));
      final slot0 = find.descendant(of: find.byKey(const Key('photo-slot-0')), matching: find.text('p3'));
      expect(slot0, findsOneWidget);
    });

    testWidgets('Continue needs 2 photos; adding one uploads the compressed bytes', (tester) async {
      final profiles = FakeProfileRepository(photoIds: <String>['p1']);
      await pumpSignedIn(
        tester,
        profiles: profiles,
        screen: () => const ProfileEditorScreen(onboarding: true, imageBuilder: _testImage),
      );

      FilledButton continueButton() => tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Continue'));
      expect(find.text('Add at least 2 photos to continue.'), findsOneWidget);
      expect(continueButton().onPressed, isNull);

      await tester.tap(find.bySemanticsLabel('Add a photo'));
      await tester.pumpAndSettle();
      expect(profiles.calls, contains('uploadPhoto:1024'));
      expect(continueButton().onPressed, isNotNull);

      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(profiles.calls, contains('updateProfile'));
      expect(find.text('VERIFY INTRO'), findsOneWidget);
    });

    testWidgets('tapping a photo can make it the main photo', (tester) async {
      final profiles = FakeProfileRepository(photoIds: <String>['p1', 'p2']);
      await pumpSignedIn(
        tester,
        profiles: profiles,
        screen: () => const ProfileEditorScreen(imageBuilder: _testImage),
      );

      await tester.tap(find.byKey(const Key('photo-slot-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Make main photo'));
      await tester.pumpAndSettle();

      expect(profiles.calls, contains('primary:p2'));
      expect(find.descendant(of: find.byKey(const Key('photo-slot-0')), matching: find.text('p2')), findsOneWidget);
    });

    testWidgets('adds a prompt answer and saves bio, intent and prompts', (tester) async {
      final profiles = FakeProfileRepository(photoIds: <String>['p1', 'p2']);
      await pumpSignedIn(
        tester,
        profiles: profiles,
        screen: () => const ProfileEditorScreen(imageBuilder: _testImage),
      );

      await tester.enterText(find.byKey(const Key('bio')), 'Abuja-based, Lagos at heart.');
      await tester.ensureVisible(find.text('Friendship'));
      await tester.tap(find.text('Friendship'));
      await tester.ensureVisible(find.byKey(const Key('add-prompt')));
      await tester.tap(find.byKey(const Key('add-prompt')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('The green flag I look for…'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('prompt-answer')), 'Kindness to waiters.');
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(find.text('Prompts (1/5)'), findsOneWidget);

      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(profiles.savedBio, 'Abuja-based, Lagos at heart.');
      expect(profiles.savedIntent, DatingIntent.friendship);
      expect(profiles.savedPrompts!.single.promptId, 'green_flag');
      expect(profiles.savedPrompts!.single.answer, 'Kindness to waiters.');
    });
  });

  group('Smile ID pre-check explainer (Screen 4)', () {
    testWidgets('explains the three steps and what we keep', (tester) async {
      await pumpSignedIn(tester, screen: () => const VerifyIntroScreen());
      expect(find.text('Verified, not anonymous.'), findsOneWidget);
      expect(find.text('Take a quick selfie'), findsOneWidget);
      expect(find.text('Confirm your ID'), findsOneWidget);
      expect(find.text('Get your gold badge'), findsOneWidget);
      expect(find.text('What we keep'), findsOneWidget);
    });

    testWidgets("\"I'll do it later\" goes to browse-only home", (tester) async {
      await pumpSignedIn(tester, screen: () => const VerifyIntroScreen());
      await tester.tap(find.text("I'll do it later"));
      await tester.pumpAndSettle();
      expect(find.text('HOME'), findsOneWidget);
    });

    testWidgets('Start verification calls the verification hook', (tester) async {
      var started = false;
      await pumpSignedIn(tester, screen: () => VerifyIntroScreen(onStartVerification: () => started = true));
      await tester.tap(find.text('Start verification'));
      await tester.pump();
      expect(started, isTrue);
    });

    testWidgets('until Smile ID is wired, Start explains it is coming', (tester) async {
      await pumpSignedIn(tester, screen: () => const VerifyIntroScreen());
      await tester.tap(find.text('Start verification'));
      await tester.pump();
      expect(find.byKey(const Key('verify-coming-soon')), findsOneWidget);
    });

    testWidgets('"Secured by Smile ID" opens the details sheet', (tester) async {
      await pumpSignedIn(tester, screen: () => const VerifyIntroScreen());
      await tester.ensureVisible(find.byKey(const Key('smile-id-details')));
      await tester.tap(find.byKey(const Key('smile-id-details')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('smile-id-sheet')), findsOneWidget);
      expect(find.textContaining('NIMC record'), findsOneWidget);
    });
  });

  group('compressToTarget', () {
    test('lowers quality, then size, until the photo fits 300 KB', () async {
      final attempts = <String>[];
      final result = await compressToTarget(
        Uint8List(5 * 1024 * 1024),
        encoder: (bytes, edge, quality) async {
          attempts.add('$edge@$quality');
          // Pretend each step roughly halves the size; 1080@60 is the first under 300 KB.
          final size = edge == 1080 ? 250 * 1024 : 400 * 1024;
          return Uint8List(size);
        },
      );
      expect(result.length, lessThanOrEqualTo(kTargetPhotoBytes));
      expect(attempts, <String>['1440@85', '1440@75', '1440@65', '1280@65', '1080@60']);
    });

    test('returns the smallest attempt if nothing fits', () async {
      final result = await compressToTarget(
        Uint8List(10),
        encoder: (bytes, edge, quality) async => Uint8List(400 * 1024 + edge),
      );
      expect(result.length, 400 * 1024 + 800);
    });
  });
}
