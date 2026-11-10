import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/secure_store.dart';
import 'package:amivara/features/auth/auth_providers.dart';
import 'package:amivara/features/discovery/discovery_providers.dart';
import 'package:amivara/features/home/home_screen.dart';
import 'package:amivara/features/profile/photo_processor.dart';
import 'package:amivara/features/profile/profile_providers.dart';
import 'package:amivara/features/verification/verification_providers.dart';
import 'package:amivara/features/verification/verification_repository.dart';
import 'package:amivara/main.dart';

import 'support/fakes.dart';

/// The real app (router, theme, guards) signed in, starting at [location].
Future<ProviderContainer> pumpVerification(
  WidgetTester tester, {
  required FakeVerificationRepository verification,
  FakeIdentityCapture? capture,
  String location = '/verify/nin',
}) async {
  // The checking screen has an endless spinner, so it never "settles".
  final settles = location != '/verify/submitting';
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);

  final container = ProviderContainer(
    overrides: [
      authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
      secureStoreProvider.overrideWithValue(MemoryStore()),
      profileRepositoryProvider.overrideWithValue(FakeProfileRepository()),
      photoProcessorProvider.overrideWithValue(FakePhotoProcessor() as PhotoProcessor),
      verificationRepositoryProvider.overrideWithValue(verification),
      identityCaptureProvider.overrideWithValue(capture ?? FakeIdentityCapture()),
      discoveryRepositoryProvider.overrideWithValue(FakeDiscoveryRepository()),
      locationSourceProvider.overrideWithValue(FakeLocationSource()),
      cardImageBuilderProvider.overrideWithValue(placeholderImage),
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
  if (settles) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump(const Duration(milliseconds: 100));
  }
  return container;
}

Future<void> enterNinAndStart(WidgetTester tester, {String nin = '12345678901'}) async {
  await tester.enterText(find.byKey(const Key('nin-field')), nin);
  await tester.ensureVisible(find.byKey(const Key('nin-consent')));
  await tester.tap(find.byKey(const Key('nin-consent')));
  await tester.pump();
  await tester.tap(find.text('Verify my identity'));
  await tester.pumpAndSettle();
}

/// The submitting screen has an endless spinner, so advance time with pump, not pumpAndSettle.
Future<void> pollOnce(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 3));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 600));
}

void main() {
  testWidgets('NIN screen: needs 11 digits and consent before starting', (tester) async {
    final verification = FakeVerificationRepository();
    await pumpVerification(tester, verification: verification);

    FilledButton start() => tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Verify my identity'));
    await tester.enterText(find.byKey(const Key('nin-field')), '1234567890');
    await tester.pump();
    expect(start().onPressed, isNull);

    await tester.enterText(find.byKey(const Key('nin-field')), '12345678901');
    await tester.pump();
    expect(start().onPressed, isNull, reason: 'consent is required');

    await tester.ensureVisible(find.byKey(const Key('nin-consent')));
    await tester.tap(find.byKey(const Key('nin-consent')));
    await tester.pump();
    expect(start().onPressed, isNotNull);
    expect(verification.sessions, 0);
  });

  testWidgets('PASSED: NIN → SDK capture → checking → gold badge → home', (tester) async {
    final verification = FakeVerificationRepository(
      statuses: <VerificationStatus>[
        vStatus(VerificationOutcome.pending),
        vStatus(VerificationOutcome.passed, verified: true, attemptsLeft: 0),
      ],
    );
    final capture = FakeIdentityCapture();
    final container = await pumpVerification(tester, verification: verification, capture: capture);

    await enterNinAndStart(tester);
    expect(verification.sessions, 1);
    // The NIN goes to the Smile ID SDK with our server-issued job ids, never to our API.
    expect(capture.lastNin, '12345678901');
    expect(capture.lastTicket!.jobId, 'job-1');

    await tester.tap(find.text('SDK: submitted'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.text('Checking your details…'), findsOneWidget);
    expect(container.read(verificationFlowProvider).nin, isNull, reason: 'NIN forgotten once submitted');

    await pollOnce(tester); // pending
    expect(find.text('Checking your details…'), findsOneWidget);
    await pollOnce(tester); // passed
    await tester.pumpAndSettle();

    expect(find.text("You're verified ✦"), findsOneWidget);
    expect(find.byKey(const Key('gold-badge')), findsOneWidget);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('edit-profile')), findsOneWidget); // home
  });

  testWidgets('FAILED with tries left: Try again returns to the NIN screen', (tester) async {
    final verification = FakeVerificationRepository(
      statuses: <VerificationStatus>[vStatus(VerificationOutcome.failed, attemptsLeft: 2)],
    );
    await pumpVerification(tester, verification: verification);
    await enterNinAndStart(tester);
    await tester.tap(find.text('SDK: submitted'));
    await tester.pump(const Duration(milliseconds: 600));
    await pollOnce(tester);
    await tester.pumpAndSettle();

    expect(find.text("We couldn't verify you this time"), findsOneWidget);
    expect(find.textContaining('2 tries left'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Enter your NIN'), findsOneWidget);
  });

  testWidgets('MANUAL REVIEW: explains the 24-hour review', (tester) async {
    await pumpVerification(
      tester,
      verification: FakeVerificationRepository(),
      location: '/verify/result?status=manual_review',
    );
    expect(find.text("We're taking a closer look"), findsOneWidget);
    expect(find.textContaining('24 hours'), findsOneWidget);
  });

  testWidgets('no result after the wait: "Almost there", keep browsing', (tester) async {
    final verification = FakeVerificationRepository(); // always pending
    await pumpVerification(tester, verification: verification, location: '/verify/submitting');
    for (var i = 0; i < 21; i++) {
      await tester.pump(const Duration(seconds: 3));
    }
    await tester.pumpAndSettle();
    expect(find.text('Almost there'), findsOneWidget);
    expect(find.text('Continue browsing'), findsOneWidget);
  });

  testWidgets('the checking screen cannot be backed out of', (tester) async {
    await pumpVerification(tester, verification: FakeVerificationRepository(), location: '/verify/submitting');
    final popped = await tester.binding.handlePopRoute();
    await tester.pump();
    expect(popped, isTrue);
    expect(find.text('Checking your details…'), findsOneWidget);
  });

  testWidgets('an SDK error (e.g. camera denied) returns to the NIN screen with a message', (tester) async {
    await pumpVerification(tester, verification: FakeVerificationRepository());
    await enterNinAndStart(tester);
    await tester.tap(find.text('SDK: error'));
    await tester.pumpAndSettle();
    expect(find.text('Enter your NIN'), findsOneWidget);
    expect(find.text('Camera permission denied'), findsOneWidget);
  });

  testWidgets('a build without Smile ID config says verification is unavailable', (tester) async {
    final verification = FakeVerificationRepository();
    await pumpVerification(tester, verification: verification, capture: FakeIdentityCapture(available: false));
    await enterNinAndStart(tester);
    expect(find.textContaining("isn't available in this version"), findsOneWidget);
    expect(verification.sessions, 0);
  });

  testWidgets('already verified: goes straight to the success screen', (tester) async {
    await pumpVerification(
      tester,
      verification: FakeVerificationRepository(sessionError: apiError(409, 'ALREADY_VERIFIED')),
    );
    await enterNinAndStart(tester);
    expect(find.text("You're verified ✦"), findsOneWidget);
  });
}
