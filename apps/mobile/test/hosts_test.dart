import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/features/chat/chat_repository.dart';
import 'package:amivara/features/hosts/host_screen.dart';

import 'matches_test.dart' show pumpMatches;
import 'settings_test.dart' show pumpSettings;
import 'support/fakes.dart';

/// Milestone 3: paid conversations with Verified Hosts, the Host icebreaker bar and the Host screen.
Future<FakeChatRepository> openChat(WidgetTester tester, ChatPage page, {List<String> icebreakers = const []}) async {
  final chat = FakeChatRepository(pages: [page])..icebreakerList = icebreakers;
  await pumpMatches(
    tester,
    matches: FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]),
    chat: chat,
    socket: FakeChatSocket(online: false),
  );
  await tester.tap(find.byKey(const Key('match-m1')));
  await tester.pumpAndSettle();
  return chat;
}

const locked = PhotoUnlock(unlocked: false, threshold: 3, mine: 0, theirs: 0);

void main() {
  testWidgets('chatting with a Verified Host shows the free allowance and the price', (tester) async {
    await openChat(
      tester,
      const ChatPage(
        messages: [],
        photos: locked,
        billing: ChatBilling(paid: true, priceCoins: 10, freePerDay: 3, freeRemainingToday: 2),
      ),
    );
    expect(find.byKey(const Key('chat-host-billing')), findsOneWidget);
    expect(
      find.textContaining('Kunle is a Verified Host. 2 free messages left today, then 10 coins each.'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('icebreaker-bar')), findsNothing); // only for the Host
  });

  testWidgets('a normal conversation shows no price', (tester) async {
    await openChat(tester, const ChatPage(messages: [], photos: locked));
    expect(find.byKey(const Key('chat-host-billing')), findsNothing);
  });

  testWidgets('Hosts get one-tap icebreakers: tap fills the box, long-press sends', (tester) async {
    final chat = await openChat(
      tester,
      const ChatPage(messages: [], photos: locked, hostTools: true),
      icebreakers: ["You're into football too! What got you started?", 'Best place for small chops in Lagos?'],
    );
    expect(chat.calls, contains('icebreakers'));
    expect(find.byKey(const Key('icebreaker-bar')), findsOneWidget);

    await tester.tap(find.byKey(const Key('icebreaker-0')));
    await tester.pump();
    expect(
      tester.widget<TextField>(find.byKey(const Key('chat-input'))).controller!.text,
      "You're into football too! What got you started?",
    );

    await tester.ensureVisible(find.byKey(const Key('icebreaker-1')));
    await tester.pumpAndSettle();
    await tester.longPress(find.byKey(const Key('icebreaker-1')));
    await tester.pumpAndSettle();
    expect(chat.calls, contains('send:Best place for small chops in Lagos?'));
  });

  testWidgets('verified members can opt in to hosting from Settings, and pause', (tester) async {
    final host = FakeHostRepository();
    await pumpSettings(tester, host: host);
    await tester.scrollUntilVisible(find.byKey(const Key('host-tile')), 200);
    await tester.tap(find.byKey(const Key('host-tile')));
    await tester.pumpAndSettle();
    expect(find.text('Become a Verified Host'), findsOneWidget);

    await tester.tap(find.byKey(const Key('host-opt-in')));
    await tester.pumpAndSettle();
    expect(host.calls, ['load', 'optIn']);
    expect(find.text("You're a Verified Host"), findsOneWidget);
    expect(find.byKey(const Key('host-earnings')), findsOneWidget);

    await tester.tap(find.byKey(const Key('host-pause')));
    await tester.pumpAndSettle();
    expect(find.text('Resume hosting'), findsOneWidget);
  });

  testWidgets('earnings show held and available coins', (tester) async {
    await pumpSettings(
      tester,
      host: FakeHostRepository(state: const HostState(status: 'active', pendingCoins: 1250, availableCoins: 40)),
    );
    await tester.scrollUntilVisible(find.byKey(const Key('host-tile')), 200);
    await tester.tap(find.byKey(const Key('host-tile')));
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.byKey(const Key('host-pending'))).data, '1,250 coins');
    expect(tester.widget<Text>(find.byKey(const Key('host-available'))).data, '40 coins');
  });

  testWidgets('unverified members are not offered hosting', (tester) async {
    await pumpSettings(tester, verified: false);
    expect(find.byKey(const Key('host-tile')), findsNothing);
  });
}
