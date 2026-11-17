import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/api_client.dart';
import 'package:amivara/features/auth/auth_repository.dart';
import 'package:amivara/features/auth/google_auth.dart';
import 'package:amivara/features/chat/chat_repository.dart';
import 'package:amivara/features/chat/chat_screen.dart';
import 'package:amivara/features/home/home_screen.dart';
import 'package:amivara/features/onboarding/dob_screen.dart';
import 'package:amivara/features/onboarding/guidelines_screen.dart';

import 'auth_flow_test.dart' show tapVisible;
import 'discovery_test.dart' show pumpHome;
import 'matches_test.dart' show pumpMatches;
import 'settings_test.dart' show pumpSettings;
import 'support/fakes.dart';

const unlocked = PhotoUnlock(unlocked: false, threshold: 3, mine: 0, theirs: 0);

/// Opens the chat with Kunle (match m1).
Future<({FakeChatRepository chat, FakeChatSocket socket})> openChat(WidgetTester tester, {bool online = true}) async {
  final chat = FakeChatRepository(
    pages: [ChatPage(messages: const [], photos: unlocked)],
  );
  final socket = FakeChatSocket(online: online);
  await pumpMatches(
    tester,
    matches: FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]),
    chat: chat,
    socket: socket,
  );
  await tester.tap(find.byKey(const Key('match-m1')));
  await tester.pumpAndSettle();
  return (chat: chat, socket: socket);
}

void main() {
  group('Email-first sign-in', () {
    testWidgets('Create account opens the email screen; a code goes to the email', (tester) async {
      final repo = FakeAuthRepository()
        ..then(kEmailChallenge)
        ..then(const SignupRequired('signup-token'));
      await pumpApp(tester, repo: repo);
      await tapVisible(tester, find.byKey(const Key('welcome-consent')));
      await tapVisible(tester, find.text('Create account'));
      await tester.pumpAndSettle();

      expect(find.text("What's your email?"), findsOneWidget);
      expect(find.byKey(const Key('use-phone')), findsOneWidget);
      FilledButton send() => tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Send code'));
      await tester.enterText(find.byKey(const Key('email-field')), 'not an email');
      await tester.pump();
      expect(send().onPressed, isNull);

      await tester.enterText(find.byKey(const Key('email-field')), '  Adaeze@Example.com ');
      await tester.pump();
      await tester.tap(find.text('Send code'));
      await tester.pumpAndSettle();
      expect(repo.lastEmail, 'adaeze@example.com');
      expect(find.textContaining('Sent to adaeze@example.com'), findsOneWidget);
      expect(find.text('Change email'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('otp-field')), '123456');
      await tester.pumpAndSettle();
      expect(repo.calls, containsAllInOrder(<String>['requestEmailOtp:adaeze@example.com', 'verifyOtp']));
      expect(find.byType(DobScreen), findsOneWidget); // on to Screen 3 (date of birth)
    });

    testWidgets('Google Sign-In: an existing member goes straight home', (tester) async {
      final repo = FakeAuthRepository()..then(const SignedIn(kTokens));
      final google = FakeGoogleAuth();
      await pumpApp(tester, repo: repo, extraOverrides: [googleAuthProvider.overrideWithValue(google)]);
      await tapVisible(tester, find.byKey(const Key('welcome-consent')));
      await tapVisible(tester, find.text('Create account'));
      await tester.pumpAndSettle();
      await tapVisible(tester, find.byKey(const Key('google-signin')));
      await tester.pumpAndSettle();
      expect(google.calls, 1);
      expect(repo.lastGoogleToken, 'google-id-token');
      expect(find.byType(HomeScreen), findsOneWidget);
    });

    testWidgets('cancelling Google changes nothing; no button without a client id', (tester) async {
      final repo = FakeAuthRepository();
      await pumpApp(
        tester,
        repo: repo,
        extraOverrides: [googleAuthProvider.overrideWithValue(FakeGoogleAuth(token: null))],
      );
      await tapVisible(tester, find.byKey(const Key('welcome-consent')));
      await tapVisible(tester, find.text('Create account'));
      await tester.pumpAndSettle();
      await tapVisible(tester, find.byKey(const Key('google-signin')));
      await tester.pumpAndSettle();
      expect(repo.calls, isNot(contains('googleSignIn')));
      expect(find.text("What's your email?"), findsOneWidget);
    });

    testWidgets('the Google button is hidden when the build has no Google client id', (tester) async {
      await pumpApp(
        tester,
        repo: FakeAuthRepository(),
        extraOverrides: [googleAuthProvider.overrideWithValue(FakeGoogleAuth(available: false))],
      );
      await tapVisible(tester, find.byKey(const Key('welcome-consent')));
      await tapVisible(tester, find.text('Create account'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('google-signin')), findsNothing);
    });
  });

  group('Community guidelines', () {
    testWidgets('shown before discovery until accepted, then home', (tester) async {
      final repo = FakeAuthRepository()..guidelinesAccepted = false;
      await pumpHome(tester, discovery: FakeDiscoveryRepository(), auth: repo);

      expect(find.byType(GuidelinesScreen), findsOneWidget);
      // A lazy list: scroll each rule into view before checking it.
      final list = find.descendant(of: find.byKey(const Key('guidelines')), matching: find.byType(Scrollable));
      for (final title in <String>['18+ only', 'No nudity', 'No scams', 'Keep chats in AMIVARA', 'Be respectful']) {
        await tester.scrollUntilVisible(find.text(title), 120, scrollable: list.first);
        expect(find.text(title), findsOneWidget);
      }
      await tapVisible(tester, find.byKey(const Key('accept-guidelines')));
      await tester.pumpAndSettle();
      expect(repo.calls, contains('acceptGuidelines'));
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(find.byType(GuidelinesScreen), findsNothing);
    });
  });

  group('Chat safety', () {
    testWidgets('a contact-sharing notice warns the recipient and can be dismissed', (tester) async {
      final opened = await openChat(tester);
      opened.socket.push('safety.notice', {'match_id': 'm1', 'kind': 'contact_sharing', 'role': 'recipient'});
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('contact-warning')), findsOneWidget);
      expect(find.textContaining('Kunle may be asking to move off AMIVARA'), findsOneWidget);
      await tester.tap(find.byTooltip('Dismiss'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('contact-warning')), findsNothing);
    });

    testWidgets('the sender is reminded too when sending over REST', (tester) async {
      final opened = await openChat(tester, online: false);
      opened.chat.safetyNoticeOnSend = 'contact_sharing';
      await tester.enterText(find.byKey(const Key('chat-input')), 'my number is 0803 123 4567');
      await tester.pump();
      await tester.tap(find.byKey(const Key('chat-send')));
      await tester.pumpAndSettle();
      expect(find.text('my number is 0803 123 4567'), findsOneWidget); // still sent
      expect(find.textContaining('keep conversations on AMIVARA'), findsOneWidget);
    });

    testWidgets('hitting the unverified daily cap offers verification and keeps the text', (tester) async {
      final opened = await openChat(tester, online: false);
      opened.chat.sendError = const ApiException(403, 'VERIFICATION_REQUIRED', 'Verify to keep chatting.');
      await tester.enterText(find.byKey(const Key('chat-input')), 'one more');
      await tester.pump();
      await tester.tap(find.byKey(const Key('chat-send')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('chat-cap-banner')), findsOneWidget);
      expect(find.text('one more'), findsOneWidget); // kept in the box
      await tester.tap(find.byKey(const Key('chat-get-verified')));
      await tester.pumpAndSettle();
      expect(find.text('Verified, not anonymous.'), findsOneWidget);
    });

    testWidgets('the same cap arriving over the socket shows the banner', (tester) async {
      final opened = await openChat(tester);
      opened.socket.push('error', {'code': 'VERIFICATION_REQUIRED', 'message': 'Verify to keep chatting.'});
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('chat-cap-banner')), findsOneWidget);
      expect(find.byType(ChatScreen), findsOneWidget);
    });
  });

  testWidgets('Settings offers Get verified only while unverified', (tester) async {
    await pumpSettings(tester, verified: false);
    expect(find.byKey(const Key('get-verified-tile')), findsOneWidget);
  });

  testWidgets('verified members are not offered verification again', (tester) async {
    await pumpSettings(tester);
    expect(find.byKey(const Key('get-verified-tile')), findsNothing);
  });
}
