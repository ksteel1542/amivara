import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/features/calls/call_repository.dart';
import 'package:amivara/features/hosts/host_connect.dart';
import 'package:amivara/features/hosts/host_screen.dart';

import 'auth_flow_test.dart' show tapVisible;
import 'matches_test.dart' show pumpMatches;
import 'settings_test.dart' show pumpSettings;
import 'support/fakes.dart';

const ada = PersonCard(userId: 'host-1', firstName: 'Ada', age: 27, city: 'Lagos');

void main() {
  group('Welcome: 18+ and Terms consent', () {
    testWidgets('sign-in stays off until the box is ticked; the links open Terms and Privacy', (tester) async {
      await pumpApp(tester, repo: FakeAuthRepository());
      final create = find.byKey(const Key('welcome-create'));
      await tester.ensureVisible(create);
      expect(tester.widget<FilledButton>(create).onPressed, isNull);
      expect(tester.widget<TextButton>(find.byKey(const Key('welcome-sign-in'))).onPressed, isNull);
      expect(find.textContaining('I confirm I am 18+'), findsOneWidget);

      await tester.tapOnText(find.textRange.ofSubstring('Terms of Service'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('legal-terms')), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tapOnText(find.textRange.ofSubstring('Privacy Policy'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('legal-privacy')), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();

      await tapVisible(tester, find.byKey(const Key('welcome-consent')));
      await tester.pumpAndSettle();
      expect(tester.widget<FilledButton>(create).onPressed, isNotNull);
      await tapVisible(tester, create);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('welcome-create')), findsNothing); // on to the email screen
    });
  });

  group('Verified Hosts online', () {
    testWidgets('Home shows online Hosts; one tap opens a chat without a match', (tester) async {
      final connect = FakeHostConnectRepository(hosts: [ada]);
      await pumpMatches(tester, matches: FakeMatchesRepository(), connect: connect, location: '/home');
      expect(find.byKey(const Key('online-hosts')), findsOneWidget);
      await tester.tap(find.byKey(const Key('online-host-host-1')));
      await tester.pumpAndSettle();
      expect(connect.calls, ['chat:host-1']);
      expect(find.text('Ada, 27'), findsOneWidget); // the chat with Ada
    });

    testWidgets('no strip when no Host is online', (tester) async {
      await pumpMatches(tester, matches: FakeMatchesRepository(), location: '/home');
      expect(find.byKey(const Key('online-hosts')), findsNothing);
    });
  });

  group('Calls: ringtone, price before answering, free preview', () {
    testWidgets('a Host invite rings with the ringtone, says what it costs, and the preview counts down', (
      tester,
    ) async {
      final signalling = FakeChatSocket();
      final ringtone = FakeRingtone();
      final calls = FakeCallRepository();
      await pumpMatches(
        tester,
        matches: FakeMatchesRepository(),
        callSocket: signalling,
        ringtone: ringtone,
        calls: calls,
        location: '/home',
      );
      signalling.push('call:ring', {
        'call': {
          ...callJson('inv-9', caller: false, type: 'video', rate: 60),
          'you_pay': true,
          'preview_seconds': 15,
          'invite': true,
        },
        'caller': {'id': 'host-1', 'first_name': 'Ada'},
      });
      await tester.pumpAndSettle();
      expect(ringtone.log, ['start']);
      expect(find.text('invites you to a live video call'), findsOneWidget);
      expect(find.text('First 15 s free, then 60 coins/min'), findsOneWidget);

      await tester.tap(find.byKey(const Key('call-decline')));
      await tester.pump();
      expect(ringtone.log, ['start', 'stop']);
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
    });

    testWidgets('the call buttons mention the free first call', (tester) async {
      final calls = FakeCallRepository(
        quoteResult: const CallQuote(
          available: true,
          allowed: true,
          paid: true,
          voiceRate: 30,
          videoRate: 60,
          youPay: true,
          freePreviewSeconds: 15,
        ),
      );
      await pumpMatches(
        tester,
        matches: FakeMatchesRepository(matches: [matchOf('m1', name: 'Ada')]),
        calls: calls,
      );
      await tester.tap(find.byKey(const Key('match-m1')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<IconButton>(find.byKey(const Key('chat-voice-call'))).tooltip,
        'Voice call · first 15 s free, then 30 coins/min',
      );
    });
  });

  group('Quick Connect and call invites', () {
    testWidgets('online Hosts see newcomers and ring them', (tester) async {
      final connect = FakeHostConnectRepository(
        newcomers: [const PersonCard(userId: 'new-1', firstName: 'Tobi', age: 24, city: 'Abuja')],
      );
      await pumpSettings(
        tester,
        host: FakeHostRepository(state: const HostState(status: 'active', pendingCoins: 0, availableCoins: 0)),
        connect: connect,
      );
      await tester.scrollUntilVisible(find.byKey(const Key('host-tile')), 200);
      await tester.tap(find.byKey(const Key('host-tile')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('newcomers-panel')), findsOneWidget);
      expect(find.text('Tobi, 24'), findsOneWidget);
      await tester.tap(find.byKey(const Key('newcomer-video-new-1')));
      await tester.pumpAndSettle();
      expect(connect.calls, ['invite:new-1:video']);
      expect(find.text('Invited'), findsOneWidget);
    });

    testWidgets('members can turn live call invites off in Settings', (tester) async {
      final connect = FakeHostConnectRepository();
      await pumpSettings(tester, connect: connect);
      final toggle = find.byKey(const Key('call-invites-switch'));
      expect(tester.widget<SwitchListTile>(toggle).value, isTrue);
      await tester.tap(toggle);
      await tester.pumpAndSettle();
      expect(connect.calls, ['invites:false']);
      expect(tester.widget<SwitchListTile>(toggle).value, isFalse);
    });
  });
}
