import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/api_client.dart';
import 'package:amivara/features/chat/chat_repository.dart';
import 'package:amivara/features/chat/chat_screen.dart';

import 'discovery_test.dart' show pumpHome;
import 'matches_test.dart' show pumpMatches;
import 'support/fakes.dart';

const locked = PhotoUnlock(unlocked: false, threshold: 3, mine: 0, theirs: 0);

Future<void> openCardSafety(WidgetTester tester, String userId) async {
  await tester.tap(find.byKey(Key('card-safety-$userId')));
  await tester.pumpAndSettle();
  expect(find.byKey(const Key('safety-menu')), findsOneWidget);
}

void main() {
  testWidgets('discovery card: Safety & Report menu offers report and block', (tester) async {
    await pumpHome(
      tester,
      discovery: FakeDiscoveryRepository(
        cards: [
          card('a', name: 'Tunde'),
          card('b'),
        ],
      ),
    );
    await openCardSafety(tester, 'a');
    expect(find.text('Safety & Report'), findsOneWidget);
    expect(find.text('Report Tunde'), findsOneWidget);
    expect(find.text('Block Tunde'), findsOneWidget);
  });

  testWidgets('report from a card: pick a category, add details, submit; the card leaves', (tester) async {
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
    await openCardSafety(tester, 'a');
    await tester.tap(find.byKey(const Key('safety-report')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('report-sheet')), findsOneWidget);
    expect(find.text('Report Tunde'), findsOneWidget);
    // Nothing chosen yet: can't submit.
    expect(tester.widget<FilledButton>(find.byKey(const Key('report-submit'))).onPressed, isNull);

    await tester.tap(find.byKey(const Key('report-category-scam')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('report-details')), 'Asked me for transport money');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('report-submit')));
    await tester.tap(find.byKey(const Key('report-submit')));
    await tester.pumpAndSettle();

    expect(safety.calls, ['report:a:scam:Asked me for transport money:-']);
    expect(find.byKey(const Key('report-sheet')), findsNothing);
    expect(find.textContaining("you won't see Tunde again"), findsOneWidget);
    expect(find.byKey(const Key('card-safety-a')), findsNothing);
    expect(find.byKey(const Key('card-safety-b')), findsOneWidget);
  });

  testWidgets('"Something else" needs details; underage explains the suspension', (tester) async {
    await pumpHome(
      tester,
      discovery: FakeDiscoveryRepository(cards: [card('a', name: 'Tunde')]),
    );
    await openCardSafety(tester, 'a');
    await tester.tap(find.byKey(const Key('safety-report')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('report-category-underage')));
    await tester.pump();
    expect(find.byKey(const Key('report-underage-note')), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('report-submit'))).onPressed, isNotNull);

    await tester.ensureVisible(find.byKey(const Key('report-category-other')));
    await tester.tap(find.byKey(const Key('report-category-other')));
    await tester.pump();
    expect(find.byKey(const Key('report-underage-note')), findsNothing);
    expect(tester.widget<FilledButton>(find.byKey(const Key('report-submit'))).onPressed, isNull);
    await tester.enterText(find.byKey(const Key('report-details')), 'Pretending to be my friend');
    await tester.pump();
    expect(tester.widget<FilledButton>(find.byKey(const Key('report-submit'))).onPressed, isNotNull);
  });

  testWidgets('a failed report keeps the sheet open with the error', (tester) async {
    final safety = FakeSafetyRepository()
      ..error = const ApiException(429, 'REPORT_RATE_LIMITED', "You've sent a lot of reports today.");
    await pumpHome(
      tester,
      discovery: FakeDiscoveryRepository(cards: [card('a', name: 'Tunde')]),
      safety: safety,
    );
    await openCardSafety(tester, 'a');
    await tester.tap(find.byKey(const Key('safety-report')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('report-category-harassment')));
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('report-submit')));
    await tester.tap(find.byKey(const Key('report-submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('report-sheet')), findsOneWidget);
    expect(find.text("You've sent a lot of reports today."), findsOneWidget);
    expect(find.byKey(const Key('card-safety-a')), findsOneWidget);
  });

  testWidgets('block from a card: confirm, then the card leaves', (tester) async {
    final safety = FakeSafetyRepository();
    await pumpHome(
      tester,
      discovery: FakeDiscoveryRepository(
        cards: [
          card('a', name: 'Tunde'),
          card('b'),
        ],
      ),
      safety: safety,
    );
    await openCardSafety(tester, 'a');
    await tester.tap(find.byKey(const Key('safety-block')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('block-dialog')), findsOneWidget);
    expect(find.text('Block Tunde?'), findsOneWidget);

    // Cancel changes nothing.
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(safety.calls, isEmpty);
    expect(find.byKey(const Key('card-safety-a')), findsOneWidget);

    await openCardSafety(tester, 'a');
    await tester.tap(find.byKey(const Key('safety-block')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('block-confirm')));
    await tester.pumpAndSettle();
    expect(safety.calls, ['block:a']);
    expect(find.text('Tunde is blocked.'), findsOneWidget);
    expect(find.byKey(const Key('card-safety-a')), findsNothing);
  });

  testWidgets('chat: report from the safety menu points at their latest message and leaves the chat', (tester) async {
    final safety = FakeSafetyRepository();
    final chat = FakeChatRepository(
      pages: [
        ChatPage(
          messages: [
            messageOf('3', from: 'user-m1', body: 'Send ₦20k first'),
            messageOf('2', from: 'me', body: 'Hi'),
          ],
          photos: locked,
        ),
      ],
    );
    await pumpMatches(
      tester,
      matches: FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]),
      chat: chat,
      safety: safety,
    );
    await tester.tap(find.byKey(const Key('match-m1')));
    await tester.pumpAndSettle();
    expect(find.byType(ChatScreen), findsOneWidget);

    await tester.tap(find.byKey(const Key('chat-safety-menu')));
    await tester.pumpAndSettle();
    expect(find.text('Report Kunle'), findsOneWidget);
    await tester.tap(find.byKey(const Key('safety-report')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('report-category-scam')));
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('report-submit')));
    await tester.tap(find.byKey(const Key('report-submit')));
    await tester.pumpAndSettle();

    expect(safety.calls, ['report:user-m1:scam::3']);
    expect(find.byType(ChatScreen), findsNothing);
    expect(find.text('This match is no longer available.'), findsNothing);
  });

  testWidgets('chat: block leaves the chat', (tester) async {
    final safety = FakeSafetyRepository();
    await pumpMatches(
      tester,
      matches: FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]),
      chat: FakeChatRepository(
        pages: [ChatPage(messages: const [], photos: locked)],
      ),
      safety: safety,
    );
    await tester.tap(find.byKey(const Key('match-m1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('chat-safety-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('safety-block')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('block-confirm')));
    await tester.pumpAndSettle();
    expect(safety.calls, ['block:user-m1']);
    expect(find.byType(ChatScreen), findsNothing);
    expect(find.text('Kunle is blocked.'), findsOneWidget);
  });
}
