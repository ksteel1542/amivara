import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/secure_store.dart';
import 'package:amivara/features/auth/auth_providers.dart';
import 'package:amivara/features/discovery/discovery_providers.dart';
import 'package:amivara/features/home/home_screen.dart';
import 'package:amivara/features/matches/matches_providers.dart';
import 'package:amivara/features/matches/matches_repository.dart';
import 'package:amivara/features/profile/photo_processor.dart';
import 'package:amivara/features/profile/profile_providers.dart';
import 'package:amivara/features/verification/verification_providers.dart';
import 'package:amivara/main.dart';

import 'support/fakes.dart';

/// Signed-in app at [location] with fake matches + push.
Future<ProviderContainer> pumpMatches(
  WidgetTester tester, {
  required FakeMatchesRepository matches,
  FakePushRegistrar? push,
  FakeDiscoveryRepository? discovery,
  String location = '/matches',
  bool verified = true,
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);

  final container = ProviderContainer(
    overrides: [
      authRepositoryProvider.overrideWithValue(FakeAuthRepository()..verified = verified),
      secureStoreProvider.overrideWithValue(MemoryStore()),
      profileRepositoryProvider.overrideWithValue(FakeProfileRepository()),
      photoProcessorProvider.overrideWithValue(FakePhotoProcessor() as PhotoProcessor),
      verificationRepositoryProvider.overrideWithValue(FakeVerificationRepository()),
      identityCaptureProvider.overrideWithValue(FakeIdentityCapture()),
      discoveryRepositoryProvider.overrideWithValue(discovery ?? FakeDiscoveryRepository()),
      locationSourceProvider.overrideWithValue(FakeLocationSource()),
      cardImageBuilderProvider.overrideWithValue(placeholderImage),
      matchesRepositoryProvider.overrideWithValue(matches),
      pushRegistrarProvider.overrideWithValue(push ?? FakePushRegistrar()),
    ],
  );
  addTearDown(container.dispose);
  await container.read(sessionProvider.notifier).signIn(kTokens);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: AmivaraApp(initialLocation: location),
    ),
  );
  await tester.pumpAndSettle();
  return container;
}

Future<void> openUnmatch(WidgetTester tester, String matchId) async {
  await tester.tap(find.byKey(Key('match-menu-$matchId')));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Unmatch').last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('lists matches with unread badges and a say-hello prompt for new ones', (tester) async {
    await pumpMatches(
      tester,
      matches: FakeMatchesRepository(
        matches: [
          matchOf('m1', name: 'Kunle', unread: 2, last: 'How was your weekend?'),
          matchOf('m2', name: 'Emeka'),
        ],
      ),
    );
    expect(find.text('Kunle, 30'), findsOneWidget);
    expect(find.text('How was your weekend?'), findsOneWidget);
    expect(find.byKey(const Key('unread-m1')), findsOneWidget);
    expect(find.text('2'), findsOneWidget);

    expect(find.text('Emeka, 30'), findsOneWidget);
    expect(find.text('New match: say hello'), findsOneWidget);
    expect(find.byKey(const Key('unread-m2')), findsNothing);
  });

  testWidgets('empty state', (tester) async {
    await pumpMatches(tester, matches: FakeMatchesRepository());
    expect(find.byKey(const Key('matches-empty')), findsOneWidget);
  });

  testWidgets('unmatch asks for confirmation, then removes the match', (tester) async {
    final repo = FakeMatchesRepository(
      matches: [
        matchOf('m1', name: 'Kunle'),
        matchOf('m2', name: 'Emeka'),
      ],
    );
    await pumpMatches(tester, matches: repo);

    await openUnmatch(tester, 'm1');
    expect(find.byKey(const Key('unmatch-dialog')), findsOneWidget);
    expect(find.text('Unmatch Kunle?'), findsOneWidget);
    expect(find.textContaining("can't be undone"), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Unmatch'));
    await tester.pumpAndSettle();
    expect(repo.calls, contains('unmatch:m1'));
    expect(find.text('Kunle, 30'), findsNothing);
    expect(find.text('Emeka, 30'), findsOneWidget);
  });

  testWidgets('cancelling the unmatch keeps the match', (tester) async {
    final repo = FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]);
    await pumpMatches(tester, matches: repo);
    await openUnmatch(tester, 'm1');
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(repo.calls.where((c) => c.startsWith('unmatch')), isEmpty);
    expect(find.text('Kunle, 30'), findsOneWidget);
  });

  testWidgets('a match push while the list is open refreshes it', (tester) async {
    final repo = FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]);
    final push = FakePushRegistrar();
    await pumpMatches(tester, matches: repo, push: push);

    repo.matches = <MatchSummary>[]; // the other member unmatched
    push.controller.add('match.removed');
    await tester.pumpAndSettle();
    expect(find.text('Kunle, 30'), findsNothing);
    expect(repo.calls.where((c) => c == 'list').length, 2);
  });

  testWidgets('signing in registers the FCM token with the API', (tester) async {
    final repo = FakeMatchesRepository();
    final push = FakePushRegistrar();
    await pumpMatches(tester, matches: repo, push: push, location: '/home');

    expect(push.starts, 1);
    await push.onToken!('fcm-token-123');
    expect(repo.calls, contains('token:fcm-token-123'));
  });

  testWidgets('"It\'s a Match!" offers to view matches', (tester) async {
    final repo = FakeMatchesRepository(matches: [matchOf('m1', name: 'Tunde')]);
    await pumpMatches(tester, matches: repo, discovery: FakeDiscoveryRepository(matchOnLike: true), location: '/home');
    await tester.drag(find.byKey(const Key('top-card')), const Offset(320, 0));
    await tester.pumpAndSettle();
    expect(find.text("It's a Match!"), findsOneWidget);

    await tester.tap(find.text('View matches'));
    await tester.pumpAndSettle();
    expect(find.text('Matches'), findsOneWidget);
    expect(find.text('Tunde, 30'), findsOneWidget);
  });
}
