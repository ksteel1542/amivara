import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/api_client.dart';
import 'package:amivara/features/chat/chat_repository.dart';
import 'package:amivara/features/chat/chat_screen.dart';
import 'package:amivara/features/chat/chat_socket.dart';
import 'package:amivara/features/matches/matches_repository.dart';

import 'matches_test.dart' show pumpMatches;
import 'support/fakes.dart';

const them = 'user-m1';
const me = 'me';
const locked = PhotoUnlock(unlocked: false, threshold: 3, mine: 1, theirs: 2);

/// Opens the chat with Kunle (match m1) from the matches list.
Future<({FakeChatRepository chat, FakeChatSocket socket, FakeMatchesRepository matches})> openChat(
  WidgetTester tester, {
  List<ChatPage>? pages,
  bool online = true,
}) async {
  final chat = FakeChatRepository(pages: pages);
  final socket = FakeChatSocket(online: online);
  final matches = FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]);
  await pumpMatches(tester, matches: matches, chat: chat, socket: socket);
  await tester.tap(find.byKey(const Key('match-m1')));
  await tester.pumpAndSettle();
  return (chat: chat, socket: socket, matches: matches);
}

DateTime minute(int m) => DateTime.utc(2026, 11, 10, 12, m);

void main() {
  testWidgets('opens from the matches list with sender / receiver bubbles', (tester) async {
    final opened = await openChat(
      tester,
      pages: [
        ChatPage(
          messages: [
            messageOf('3', from: them, body: 'Saturday works!', at: minute(3)),
            messageOf('2', from: me, body: 'Free on Saturday?', at: minute(2), readAt: minute(3)),
            messageOf('1', from: me, body: 'Hi Kunle', at: minute(1), readAt: minute(3)),
          ],
          photos: locked,
        ),
      ],
    );

    expect(find.byType(ChatScreen), findsOneWidget);
    expect(find.text('Kunle, 30'), findsOneWidget);
    expect(opened.socket.token, 'access');

    final mine = tester.widget<Container>(find.byKey(const Key('bubble-2')));
    final theirs = tester.widget<Container>(find.byKey(const Key('bubble-3')));
    final scheme = Theme.of(tester.element(find.byType(ChatScreen))).colorScheme;
    expect((mine.decoration! as BoxDecoration).color, scheme.primary);
    expect((theirs.decoration! as BoxDecoration).color, scheme.surfaceContainer);
    // Mine on the right, theirs on the left.
    expect(
      tester.getCenter(find.byKey(const Key('bubble-2'))).dx,
      greaterThan(tester.getCenter(find.byKey(const Key('bubble-3'))).dx),
    );
    // Newest at the bottom.
    expect(tester.getCenter(find.text('Saturday works!')).dy, greaterThan(tester.getCenter(find.text('Hi Kunle')).dy));

    // Opening the chat reads their newest message, over the socket.
    expect(opened.socket.emitted.map((e) => '${e.event}:${e.data['up_to_message_id']}'), contains('message.read:3'));
  });

  testWidgets('shows read ticks and turns them on a read receipt', (tester) async {
    final opened = await openChat(
      tester,
      pages: [
        ChatPage(
          messages: [
            messageOf('2', from: me, at: minute(2)),
            messageOf('1', from: me, at: minute(1), readAt: minute(1)),
          ],
          photos: locked,
        ),
      ],
    );
    expect(find.byKey(const Key('tick-read-1')), findsOneWidget);
    expect(find.byKey(const Key('tick-sent-2')), findsOneWidget);

    opened.socket.push('message.read', {
      'match_id': 'm1',
      'up_to_message_id': '2',
      'read_at': minute(4).toIso8601String(),
    });
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('tick-read-2')), findsOneWidget);
    expect(find.byKey(const Key('tick-sent-2')), findsNothing);
  });

  testWidgets('receives live messages and shows the typing indicator', (tester) async {
    final opened = await openChat(
      tester,
      pages: [ChatPage(messages: const [], photos: locked)],
    );
    expect(find.byKey(const Key('chat-empty')), findsOneWidget);

    opened.socket.push('typing', {'match_id': 'm1', 'user_id': them});
    await tester.pump(); // delivers the event
    await tester.pump(); // renders it
    expect(find.byKey(const Key('typing-indicator')), findsOneWidget);
    expect(find.text('Kunle is typing…'), findsOneWidget);

    // Their message replaces the indicator and is marked read straight away.
    opened.socket.push('message.new', messageJson(messageOf('9', from: them, body: 'Ẹ kú irọ̀lẹ́ ✦', at: minute(9))));
    await tester.pumpAndSettle();
    expect(find.text('Ẹ kú irọ̀lẹ́ ✦'), findsOneWidget);
    expect(find.byKey(const Key('typing-indicator')), findsNothing);
    expect(opened.socket.emitted.last.event, 'message.read');
    // Their message counts towards the unlock.
    expect(find.textContaining('Kunle 3/3'), findsOneWidget);

    // Events for other matches are ignored.
    opened.socket.push('message.new', messageJson(messageOf('x', from: 'user-m2', matchId: 'm2', body: 'Other chat')));
    await tester.pumpAndSettle();
    expect(find.text('Other chat'), findsNothing);
  });

  testWidgets('the typing indicator clears after a few seconds', (tester) async {
    final opened = await openChat(
      tester,
      pages: [ChatPage(messages: const [], photos: locked)],
    );
    opened.socket.push('typing', {'match_id': 'm1', 'user_id': them});
    await tester.pump(); // delivers the event
    await tester.pump(); // renders it
    expect(find.byKey(const Key('typing-indicator')), findsOneWidget);
    await tester.pump(const Duration(seconds: 5));
    expect(find.byKey(const Key('typing-indicator')), findsNothing);
  });

  testWidgets('sends over the socket and emits typing (throttled)', (tester) async {
    final opened = await openChat(
      tester,
      pages: [ChatPage(messages: const [], photos: locked)],
    );
    expect(tester.widget<IconButton>(find.byKey(const Key('chat-send'))).onPressed, isNull);

    await tester.enterText(find.byKey(const Key('chat-input')), 'H');
    await tester.enterText(find.byKey(const Key('chat-input')), 'Hello Kunle');
    await tester.pump();
    expect(opened.socket.emitted.where((e) => e.event == 'typing'), hasLength(1));

    await tester.tap(find.byKey(const Key('chat-send')));
    await tester.pump();
    final sent = opened.socket.emitted.lastWhere((e) => e.event == 'message.send');
    expect(sent.data, {'match_id': 'm1', 'body': 'Hello Kunle'});
    expect(opened.chat.calls.where((c) => c.startsWith('send:')), isEmpty);
    expect(find.text('Hello Kunle'), findsNothing); // the bubble arrives with the server echo

    opened.socket.push('message.new', messageJson(messageOf('10', from: me, body: 'Hello Kunle', at: minute(10))));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('bubble-10')), findsOneWidget);
    expect(find.byKey(const Key('tick-sent-10')), findsOneWidget);
    // A duplicate echo doesn't duplicate the bubble.
    opened.socket.push('message.new', messageJson(messageOf('10', from: me, body: 'Hello Kunle', at: minute(10))));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('bubble-10')), findsOneWidget);
  });

  testWidgets('falls back to REST when the socket is down', (tester) async {
    final opened = await openChat(
      tester,
      online: false,
      pages: [
        ChatPage(
          messages: [messageOf('1', from: them, at: minute(1))],
          photos: locked,
        ),
      ],
    );
    expect(opened.chat.calls, contains('read:1'));

    await tester.enterText(find.byKey(const Key('chat-input')), '  Hi there  ');
    await tester.pump();
    await tester.tap(find.byKey(const Key('chat-send')));
    await tester.pumpAndSettle();
    expect(opened.chat.calls, contains('send:Hi there'));
    expect(find.text('Hi there'), findsOneWidget);
    expect(find.textContaining('You 2/3'), findsOneWidget);
  });

  testWidgets('photo unlock progress, then the unlocked state', (tester) async {
    final opened = await openChat(
      tester,
      pages: [ChatPage(messages: const [], photos: locked)],
    );
    expect(find.byKey(const Key('photo-unlock-banner')), findsOneWidget);
    expect(find.textContaining('You 1/3 · Kunle 2/3'), findsOneWidget);
    final bar = tester.widget<LinearProgressIndicator>(find.byType(LinearProgressIndicator));
    expect(bar.value, closeTo(0.5, 0.001));

    opened.socket.push('photos.unlocked', {'match_id': 'm1'});
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('photos-unlocked')), findsOneWidget);
    expect(find.byKey(const Key('photo-unlock-banner')), findsNothing);
    expect(find.text('Photos unlocked with Kunle ✦'), findsOneWidget);
  });

  testWidgets('matches list shows the photo lock state', (tester) async {
    await pumpMatches(
      tester,
      matches: FakeMatchesRepository(
        matches: [
          matchOf('m1', name: 'Kunle'),
          MatchSummary(
            matchId: 'm2',
            userId: 'user-m2',
            firstName: 'Emeka',
            age: 31,
            verified: true,
            unreadCount: 0,
            photosUnlocked: true,
          ),
        ],
      ),
    );
    expect(find.byKey(const Key('photos-locked-m1')), findsOneWidget);
    expect(find.byKey(const Key('photos-unlocked-m2')), findsOneWidget);
  });

  testWidgets('scrolling to the top loads older messages', (tester) async {
    final newest = List.generate(30, (i) => messageOf('n$i', from: i.isEven ? me : them, at: minute(59 - i)));
    final older = List.generate(
      5,
      (i) => messageOf('o$i', from: them, body: 'Older $i', at: DateTime.utc(2026, 11, 9, 20, 59 - i)),
    );
    final opened = await openChat(
      tester,
      pages: [
        ChatPage(messages: newest, photos: PhotoUnlock.open, nextBefore: 'n29'),
        ChatPage(messages: older, photos: PhotoUnlock.open),
      ],
    );
    expect(opened.chat.calls, ['history:-']);
    expect(find.byKey(const Key('photos-unlocked')), findsOneWidget);
    expect(find.text('Older 4'), findsNothing);

    // Drag towards older messages (the list is reversed: upwards on screen).
    await tester.fling(find.byKey(const Key('chat-list')), const Offset(0, 3000), 5000);
    await tester.pumpAndSettle();
    await tester.fling(find.byKey(const Key('chat-list')), const Offset(0, 3000), 5000);
    await tester.pumpAndSettle();

    expect(opened.chat.calls, ['history:-', 'history:n29']);
    expect(find.text('Older 4'), findsOneWidget);
  });

  testWidgets('leaves the chat when the match is removed', (tester) async {
    final opened = await openChat(
      tester,
      pages: [ChatPage(messages: const [], photos: locked)],
    );
    opened.socket.push('match.removed', {'match_id': 'm1'});
    await tester.pumpAndSettle();
    expect(find.byType(ChatScreen), findsNothing);
    expect(find.text('This match is no longer available.'), findsOneWidget);
    expect(opened.socket.closed, isTrue);
  });

  testWidgets('a 404 on open (already unmatched) returns to the list', (tester) async {
    final chat = FakeChatRepository()..historyError = const ApiException(404, 'NOT_FOUND', 'Gone');
    await pumpMatches(
      tester,
      matches: FakeMatchesRepository(matches: [matchOf('m1')]),
      chat: chat,
    );
    await tester.tap(find.byKey(const Key('match-m1')));
    await tester.pumpAndSettle();
    expect(find.byType(ChatScreen), findsNothing);
    expect(find.text('This match is no longer available.'), findsOneWidget);
  });

  test('chat socket URL comes from the API base URL', () {
    expect(IoChatSocket.chatSocketUrl('https://api.amivara.com/v1'), 'wss://api.amivara.com/ws/chat');
    expect(IoChatSocket.chatSocketUrl('http://10.0.2.2:4000/v1'), 'ws://10.0.2.2:4000/ws/chat');
  });
}
