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
import 'package:amivara/features/verification/verification_providers.dart';
import 'package:amivara/main.dart';

import 'support/fakes.dart';

/// Signed-in app on the discovery home.
Future<void> pumpHome(WidgetTester tester, {required FakeDiscoveryRepository discovery, bool verified = false}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);

  final auth = FakeAuthRepository()..verified = verified;
  final container = ProviderContainer(
    overrides: [
      authRepositoryProvider.overrideWithValue(auth),
      secureStoreProvider.overrideWithValue(MemoryStore()),
      profileRepositoryProvider.overrideWithValue(FakeProfileRepository()),
      photoProcessorProvider.overrideWithValue(FakePhotoProcessor() as PhotoProcessor),
      verificationRepositoryProvider.overrideWithValue(FakeVerificationRepository()),
      identityCaptureProvider.overrideWithValue(FakeIdentityCapture()),
      discoveryRepositoryProvider.overrideWithValue(discovery),
      locationSourceProvider.overrideWithValue(FakeLocationSource()),
      cardImageBuilderProvider.overrideWithValue(placeholderImage),
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
}

Future<void> swipe(WidgetTester tester, double dx) async {
  await tester.drag(find.byKey(const Key('top-card')), Offset(dx, 0));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows the top card: name, age, gold badge, rounded distance, prompts', (tester) async {
    await pumpHome(tester, discovery: FakeDiscoveryRepository());
    expect(find.text('Tunde, 29'), findsOneWidget);
    expect(find.text('6 km away'), findsWidgets);
    expect(find.byKey(const Key('verified-badge-icon')), findsWidgets);
    expect(find.text('Kindness.'), findsWidgets);
  });

  testWidgets('tapping the right half of the photo shows the next photo', (tester) async {
    await pumpHome(tester, discovery: FakeDiscoveryRepository());
    expect(find.byKey(const ValueKey<String>('photo-0')), findsWidgets);
    final card = tester.getRect(find.byKey(const Key('top-card')));
    await tester.tapAt(Offset(card.right - 40, card.top + 200));
    await tester.pump();
    expect(find.byKey(const ValueKey<String>('photo-1')), findsOneWidget);
  });

  testWidgets('swipe left passes and shows the next card', (tester) async {
    final discovery = FakeDiscoveryRepository();
    await pumpHome(tester, discovery: discovery);
    await swipe(tester, -320);
    expect(discovery.calls, contains('pass:a'));
    expect(find.text('Emeka, 29'), findsOneWidget);
  });

  testWidgets('a short drag springs back and does nothing', (tester) async {
    final discovery = FakeDiscoveryRepository();
    await pumpHome(tester, discovery: discovery);
    await swipe(tester, 40);
    expect(discovery.calls.where((c) => c.startsWith('like') || c.startsWith('pass')), isEmpty);
    expect(find.text('Tunde, 29'), findsOneWidget);
  });

  testWidgets('verified: swipe right likes; a mutual like shows the match dialog', (tester) async {
    final discovery = FakeDiscoveryRepository(matchOnLike: true);
    await pumpHome(tester, discovery: discovery, verified: true);
    await swipe(tester, 320);
    expect(discovery.calls, contains('like:a'));
    expect(find.byKey(const Key('match-dialog')), findsOneWidget);
    expect(find.text("It's a match"), findsOneWidget);
  });

  testWidgets('unverified: swiping right opens the verify prompt instead of liking', (tester) async {
    final discovery = FakeDiscoveryRepository();
    await pumpHome(tester, discovery: discovery);
    await swipe(tester, 320);

    expect(find.byKey(const Key('verify-prompt')), findsOneWidget);
    expect(discovery.calls.where((c) => c.startsWith('like')), isEmpty);

    await tester.tap(find.text('Not now'));
    await tester.pumpAndSettle();
    expect(find.text('Tunde, 29'), findsOneWidget); // the card came back
  });

  testWidgets('unverified: the Like button opens the prompt; "Verify now" goes to Smile ID', (tester) async {
    await pumpHome(tester, discovery: FakeDiscoveryRepository());
    await tester.tap(find.byKey(const Key('like-button')));
    await tester.pumpAndSettle();
    expect(find.text('Verify to start liking'), findsOneWidget);

    await tester.tap(find.text('Verify now'));
    await tester.pumpAndSettle();
    expect(find.text('Verified, not anonymous.'), findsOneWidget);
  });

  testWidgets('unverified members can still pass with the button', (tester) async {
    final discovery = FakeDiscoveryRepository();
    await pumpHome(tester, discovery: discovery);
    await tester.tap(find.byKey(const Key('pass-button')));
    await tester.pumpAndSettle();
    expect(discovery.calls, contains('pass:a'));
    expect(find.byKey(const Key('verify-prompt')), findsNothing);
  });

  testWidgets('if the server says VERIFICATION_REQUIRED, the card comes back with the prompt', (tester) async {
    final discovery = FakeDiscoveryRepository(likeError: const ApiException(403, 'VERIFICATION_REQUIRED', 'Verify'));
    await pumpHome(tester, discovery: discovery, verified: true); // app thinks verified; server disagrees
    await swipe(tester, 320);
    expect(find.byKey(const Key('verify-prompt')), findsOneWidget);
    await tester.tap(find.text('Not now'));
    await tester.pumpAndSettle();
    expect(find.text('Tunde, 29'), findsOneWidget);
  });

  testWidgets('no location yet: sharing it loads the feed', (tester) async {
    final discovery = FakeDiscoveryRepository(locationRequired: true);
    await pumpHome(tester, discovery: discovery);
    expect(find.byKey(const Key('needs-location')), findsOneWidget);

    await tester.tap(find.text('Share my location'));
    await tester.pumpAndSettle();
    expect(discovery.calls, contains('location:6.5244,3.3792'));
    expect(find.text('Tunde, 29'), findsOneWidget);
  });

  testWidgets('after the last card: "You\'ve seen everyone nearby"', (tester) async {
    final discovery = FakeDiscoveryRepository(cards: [card('only', name: 'Bayo')]);
    await pumpHome(tester, discovery: discovery);
    await swipe(tester, -320);
    expect(find.byKey(const Key('feed-empty')), findsOneWidget);
  });
}
