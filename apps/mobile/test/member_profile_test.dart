import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/features/chat/chat_repository.dart';
import 'package:amivara/features/discovery/member_profile_screen.dart';
import 'package:amivara/features/safety/blocked_screen.dart';
import 'package:amivara/features/safety/safety_repository.dart';

import 'discovery_test.dart' show pumpHome;
import 'matches_test.dart' show pumpMatches;
import 'settings_test.dart' show pumpSettings;
import 'support/fakes.dart';

void main() {
  group('Full profile', () {
    testWidgets('opens from a discovery card with bio, prompts and interests', (tester) async {
      final discovery = FakeDiscoveryRepository(
        cards: [
          card('a', name: 'Tunde'),
          card('b', name: 'Emeka'),
        ],
      );
      await pumpHome(tester, discovery: discovery);
      await tester.tap(find.byKey(const Key('card-profile-a')));
      await tester.pumpAndSettle();

      expect(find.byType(MemberProfileScreen), findsOneWidget);
      expect(discovery.calls, contains('view:a'));
      expect(find.text('Tunde, 29'), findsWidgets);
      expect(find.text('Bio of a'), findsOneWidget);
      expect(find.byKey(const Key('member-profile')), findsOneWidget);
    });

    testWidgets('a hidden profile shows a plain "no longer available"', (tester) async {
      final discovery = FakeDiscoveryRepository(cards: [card('a', name: 'Tunde')])..hidden.add('a');
      await pumpHome(tester, discovery: discovery);
      await tester.tap(find.byKey(const Key('card-profile-a')));
      await tester.pumpAndSettle();
      expect(find.text('This profile is no longer available.'), findsOneWidget);
    });

    testWidgets('blocking from the full profile returns and drops the card', (tester) async {
      final safety = FakeSafetyRepository();
      await pumpHome(
        tester,
        discovery: FakeDiscoveryRepository(
          cards: [
            card('a', name: 'Tunde'),
            card('b', name: 'Emeka'),
          ],
        ),
        safety: safety,
      );
      await tester.tap(find.byKey(const Key('card-profile-a')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('member-safety-menu')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('safety-block')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('block-confirm')));
      await tester.pumpAndSettle();

      expect(safety.calls, ['block:a']);
      expect(find.byType(MemberProfileScreen), findsNothing);
      expect(find.byKey(const Key('card-profile-a')), findsNothing);
      expect(find.byKey(const Key('card-profile-b')), findsOneWidget);
    });

    testWidgets('opens from a chat by tapping the name', (tester) async {
      final discovery = FakeDiscoveryRepository();
      await pumpMatches(
        tester,
        matches: FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]),
        chat: FakeChatRepository(
          pages: [ChatPage(messages: const [], photos: PhotoUnlock.open)],
        ),
        discovery: discovery,
      );
      await tester.tap(find.byKey(const Key('match-m1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('chat-open-profile')));
      await tester.pumpAndSettle();
      expect(find.byType(MemberProfileScreen), findsOneWidget);
      expect(discovery.calls, contains('view:user-m1'));
    });
  });

  group('Blocked members', () {
    Future<FakeSafetyRepository> openBlocked(WidgetTester tester, List<BlockedMember> blocked) async {
      final safety = FakeSafetyRepository()..blocked = blocked;
      await pumpSettings(tester, safety: safety);
      await tester.tap(find.byKey(const Key('blocked-tile')));
      await tester.pumpAndSettle();
      expect(find.byType(BlockedScreen), findsOneWidget);
      return safety;
    }

    testWidgets('lists blocked members and unblocks after confirming', (tester) async {
      final safety = await openBlocked(tester, [
        BlockedMember(userId: 'u1', firstName: 'Tunde', blockedAt: DateTime.utc(2026, 11, 2)),
        BlockedMember(userId: 'u2', firstName: 'Emeka', blockedAt: DateTime.utc(2026, 10, 20)),
      ]);
      expect(find.text('Tunde'), findsOneWidget);
      expect(find.text('Emeka'), findsOneWidget);

      await tester.tap(find.byKey(const Key('unblock-u1')));
      await tester.pumpAndSettle();
      expect(find.text('Unblock Tunde?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(safety.calls, isEmpty);

      await tester.tap(find.byKey(const Key('unblock-u1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('unblock-confirm')));
      await tester.pumpAndSettle();
      expect(safety.calls, ['unblock:u1']);
      expect(find.byKey(const Key('blocked-u1')), findsNothing);
      expect(find.byKey(const Key('blocked-u2')), findsOneWidget);
      expect(find.text('Tunde is unblocked.'), findsOneWidget);
    });

    testWidgets('empty state', (tester) async {
      await openBlocked(tester, const []);
      expect(find.byKey(const Key('blocked-empty')), findsOneWidget);
    });
  });
}
