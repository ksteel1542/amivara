import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/api_client.dart';

import 'matches_test.dart' show pumpMatches;
import 'settings_test.dart' show pumpSettings;
import 'support/fakes.dart';

/// Milestone 3b: labelled AI Companions in their own section, reply-only, with spending limits.
Future<FakeAiRepository> openCompanions(WidgetTester tester, {FakeAiRepository? ai}) async {
  final repo = ai ?? FakeAiRepository();
  await pumpMatches(
    tester,
    matches: FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]),
    ai: repo,
  );
  await tester.tap(find.byKey(const Key('ai-companions-entry')));
  await tester.pumpAndSettle();
  return repo;
}

void main() {
  testWidgets('AI Companions have their own section, each labelled, never with the gold badge', (tester) async {
    await openCompanions(tester);
    expect(find.byKey(const Key('ai-disclosure')), findsOneWidget);
    expect(find.textContaining('not real people'), findsOneWidget);
    expect(find.byKey(const Key('ai-companion-ada')), findsOneWidget);
    expect(find.byKey(const Key('ai-badge')), findsNWidgets(2));
    expect(find.byKey(const Key('verified-badge-icon')), findsNothing);
    expect(find.text('Kunle, 30'), findsNothing); // real matches aren't mixed in
  });

  testWidgets('a chat is labelled throughout and opens with the AI disclosure', (tester) async {
    final ai = await openCompanions(tester);
    await tester.tap(find.byKey(const Key('ai-companion-ada')));
    await tester.pumpAndSettle();

    expect(ai.calls, ['open:ada']);
    expect(find.byKey(const Key('ai-badge')), findsOneWidget); // in the app bar
    expect(find.byKey(const Key('ai-chat-disclosure')), findsOneWidget);
    expect(find.textContaining('an AI Companion (not a real person)'), findsOneWidget);
    expect(find.text('3 free messages left today, then 10 coins each.'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('ai-chat-input')), 'Hello Ada');
    await tester.pump();
    await tester.tap(find.byKey(const Key('ai-chat-send')));
    await tester.pumpAndSettle();
    expect(ai.calls.last, 'send:Hello Ada');
    expect(find.text('Reply 1'), findsOneWidget);
    expect(find.text('2 free messages left today, then 10 coins each.'), findsOneWidget);

    await tester.longPress(find.byKey(const Key('ai-bubble-r1')));
    await tester.pumpAndSettle();
    expect(ai.calls.last, 'report:r1');
  });

  testWidgets('out of coins opens the top-up sheet; a reached limit is explained', (tester) async {
    final ai = FakeAiRepository()
      ..sendError = const ApiException(402, 'INSUFFICIENT_COINS', 'Not enough coins', {'balance': 0, 'required': 10});
    await openCompanions(tester, ai: ai);
    await tester.tap(find.byKey(const Key('ai-companion-tolu')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('ai-chat-input')), 'hi');
    await tester.pump();
    await tester.tap(find.byKey(const Key('ai-chat-send')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('topup-sheet')), findsOneWidget);
    expect(find.text('You need 10 more coins for that.'), findsOneWidget);

    Navigator.of(tester.element(find.byKey(const Key('topup-sheet')))).pop();
    await tester.pumpAndSettle();
    ai.sendError = const ApiException(
      403,
      'SPEND_LIMIT_REACHED',
      "You've reached today's AI Companion spending limit. It resets at midnight.",
    );
    await tester.tap(find.byKey(const Key('ai-chat-send')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('ai-notice')), findsOneWidget);
    expect(find.textContaining('spending limit'), findsOneWidget);
  });

  testWidgets('spending limits: set a daily cap and take a break', (tester) async {
    final ai = FakeAiRepository();
    await pumpSettings(tester, ai: ai);
    await tester.scrollUntilVisible(find.byKey(const Key('spend-limits-tile')), 200);
    await tester.tap(find.byKey(const Key('spend-limits-tile')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('cap-100')));
    await tester.pumpAndSettle();
    expect(ai.calls, ['cap:100']);

    await tester.tap(find.byKey(const Key('break-30')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('self-exclude-dialog')), findsOneWidget);
    await tester.tap(find.byKey(const Key('self-exclude-confirm')));
    await tester.pumpAndSettle();
    expect(ai.calls.last, 'exclude:30');
    expect(find.byKey(const Key('self-excluded')), findsOneWidget);
  });
}
