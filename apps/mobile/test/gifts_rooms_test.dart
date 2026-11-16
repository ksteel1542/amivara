import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/features/chat/chat_repository.dart';
import 'package:amivara/features/rooms/rooms_repository.dart';

import 'matches_test.dart' show pumpMatches;
import 'support/fakes.dart';

const hostBilling = ChatBilling(paid: true, priceCoins: 10, freePerDay: 3, freeRemainingToday: 3);

ChatPage hostPage() => const ChatPage(
  messages: <ChatMessage>[],
  photos: PhotoUnlock(unlocked: false, threshold: 3, mine: 0, theirs: 0),
  billing: hostBilling,
);

Future<void> openHostChat(WidgetTester tester, FakeGiftRepository gifts, {FakeWalletRepository? wallet}) async {
  await pumpMatches(
    tester,
    matches: FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]),
    chat: FakeChatRepository(pages: [hostPage()]),
    gifts: gifts,
    wallet: wallet,
  );
  await tester.tap(find.byKey(const Key('match-m1')));
  await tester.pumpAndSettle();
}

RoomSummary summary({String id = 'r1', bool following = false}) => RoomSummary(
  id: id,
  title: 'Friday vibes',
  video: false,
  followersOnly: false,
  hostId: 'host-1',
  hostName: 'Ada',
  following: following,
  listeners: 3,
);

/// Opens Chat House from Home, then the room r1.
Future<({FakeRoomsRepository rooms, FakeChatSocket socket, FakeCallEngine engine})> openRoom(
  WidgetTester tester, {
  Map<String, dynamic>? joinAs,
  FakeGiftRepository? gifts,
}) async {
  final rooms = FakeRoomsRepository(rooms: [summary()], joinAs: joinAs);
  final socket = FakeChatSocket();
  final engine = FakeCallEngine();
  await pumpMatches(
    tester,
    matches: FakeMatchesRepository(),
    rooms: rooms,
    socket: socket,
    engine: engine,
    gifts: gifts,
    location: '/home',
  );
  await tester.tap(find.byKey(const Key('rooms-button')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('room-r1')));
  await tester.pumpAndSettle();
  return (rooms: rooms, socket: socket, engine: engine);
}

void main() {
  group('Gift drawer in a chat', () {
    testWidgets('only shown with Verified Hosts; one tap sends, celebrates and shows in the chat', (tester) async {
      final gifts = FakeGiftRepository();
      await openHostChat(tester, gifts);
      await tester.tap(find.byKey(const Key('chat-gift')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('gift-drawer')), findsOneWidget);
      expect(find.text('Send Kunle a gift'), findsOneWidget);
      for (final slug in ['rose', 'kiss', 'teddy', 'crown']) {
        expect(find.byKey(Key('gift-$slug')), findsOneWidget);
      }
      expect(find.text('1000'), findsOneWidget);

      await tester.tap(find.byKey(const Key('gift-kiss')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(gifts.calls.single, startsWith('chat:m1:kiss:'));
      expect(find.byKey(const Key('gift-toast')), findsOneWidget);
      expect(find.text('Kiss sent to Kunle'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3)); // the banner floats away
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('gift-toast')), findsNothing);
      expect(find.text('You sent a Kiss'), findsOneWidget);
    });

    testWidgets('no gift button in chats with members who aren’t Hosts', (tester) async {
      await pumpMatches(
        tester,
        matches: FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]),
      );
      await tester.tap(find.byKey(const Key('match-m1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('chat-gift')), findsNothing);
    });

    testWidgets('low on coins: the top-up sheet opens, then the gift goes with the same key', (tester) async {
      final gifts = FakeGiftRepository()
        ..errors.add(apiError(402, 'INSUFFICIENT_COINS', {'balance': 30, 'required': 200}));
      await openHostChat(tester, gifts);
      await tester.tap(find.byKey(const Key('chat-gift')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('gift-teddy')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('topup-sheet')), findsOneWidget);
      expect(find.text('You need 170 more coins for that.'), findsOneWidget);
      expect(gifts.calls, hasLength(1));
    });
  });

  group('Chat House', () {
    testWidgets('lists live rooms; joining connects as a listener; follow; chat', (tester) async {
      final opened = await openRoom(tester);
      expect(opened.rooms.calls, ['join:r1']);
      expect(opened.engine.log.first, 'connect:voice:listen');
      expect(find.byKey(const Key('room-screen')), findsOneWidget);
      expect(find.text('Ada · 3 listening'), findsOneWidget);
      expect(find.byKey(const Key('room-speaker-host-1')), findsOneWidget);
      expect(find.text('Open seat'), findsNWidgets(8));
      expect(find.byKey(const Key('room-mic')), findsNothing); // listeners don't publish

      await tester.tap(find.byKey(const Key('room-follow')));
      await tester.pumpAndSettle();
      expect(opened.rooms.calls.last, 'follow:host-1');
      expect(find.text('Following'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('room-chat-input')), 'Hello room!');
      await tester.tap(find.byKey(const Key('room-chat-send')));
      await tester.pumpAndSettle();
      expect(opened.rooms.calls.last, 'say:Hello room!');
      expect(find.textContaining('Hello room!'), findsOneWidget);

      opened.socket.push('room:message', {
        'room_id': 'r1',
        'message': {
          'id': 'x1',
          'sender': {'id': 'host-1', 'first_name': 'Ada'},
          'body': 'Welcome everyone',
          'created_at': '2026-11-16T20:00:00Z',
        },
      });
      await tester.pumpAndSettle();
      expect(find.textContaining('Welcome everyone'), findsOneWidget);
    });

    testWidgets('asking to speak; once seated the mic opens; the Host ending the room closes it', (tester) async {
      final opened = await openRoom(tester);
      await tester.tap(find.byKey(const Key('room-ask-seat')));
      await tester.pumpAndSettle();
      expect(opened.rooms.calls.last, 'ask:r1');

      opened.socket.push('room:updated', {
        'room': roomJson(
          role: 'speaker',
          guests: [
            {'id': 'me', 'first_name': 'Me', 'role': 'speaker', 'muted_by_host': false},
          ],
        ),
      });
      await tester.pumpAndSettle();
      expect(opened.engine.log.last, 'publish:true');
      expect(find.byKey(const Key('room-mic')), findsOneWidget);
      expect(find.text('Open seat'), findsNWidgets(7));

      opened.socket.push('room:ended', {'room_id': 'r1', 'reason': 'host_ended'});
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('room-screen')), findsNothing);
      expect(find.text('The Host ended the room.'), findsOneWidget);
    });

    testWidgets('gifts in a room go to the Host by default', (tester) async {
      final gifts = FakeGiftRepository();
      await openRoom(tester, gifts: gifts);
      await tester.tap(find.byKey(const Key('room-gift')));
      await tester.pumpAndSettle();
      expect(find.text('Send Ada a gift'), findsOneWidget);
      await tester.tap(find.byKey(const Key('gift-rose')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(gifts.calls.single, 'room:r1:rose:host');
      expect(find.text('Rose sent to Ada'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
    });

    testWidgets('the report button reports the room and leaves it', (tester) async {
      final opened = await openRoom(tester);
      await tester.tap(find.byKey(const Key('room-report')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('room-report-scam')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('room-report-scam')));
      await tester.pumpAndSettle();
      expect(opened.rooms.calls, contains('report:r1:scam'));
      expect(find.byKey(const Key('room-screen')), findsNothing);
    });

    testWidgets('Hosts go live, seat a request and manage speakers, and end the room', (tester) async {
      final rooms = FakeRoomsRepository();
      final socket = FakeChatSocket();
      final engine = FakeCallEngine();
      await pumpMatches(
        tester,
        matches: FakeMatchesRepository(),
        rooms: rooms,
        socket: socket,
        engine: engine,
        location: '/rooms',
      );
      expect(find.byKey(const Key('rooms-empty')), findsOneWidget);
      await tester.tap(find.byKey(const Key('rooms-go-live')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('go-live-title')), 'Late night talk');
      await tester.tap(find.text('Followers'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('go-live-start')));
      await tester.pumpAndSettle();
      expect(rooms.calls, ['open:Late night talk:audio:followers']);
      expect(engine.log.first, 'connect:voice'); // the Host publishes
      expect(find.byKey(const Key('room-follow')), findsNothing);
      expect(find.byKey(const Key('room-report')), findsNothing);

      socket.push('room:updated', {
        'room': roomJson(
          id: 'r-new',
          role: 'host',
          requests: [
            {'id': 'u2', 'first_name': 'Tolu', 'requested_at': '2026-11-16T20:00:00Z'},
          ],
        ),
      });
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('room-seat-u2')));
      await tester.pumpAndSettle();
      expect(rooms.calls.last, 'seat:u2');

      socket.push('room:updated', {
        'room': roomJson(
          id: 'r-new',
          role: 'host',
          guests: [
            {'id': 'u2', 'first_name': 'Tolu', 'role': 'speaker', 'muted_by_host': false},
          ],
        ),
      });
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('room-speaker-u2')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('speaker-mute')));
      await tester.pumpAndSettle();
      expect(rooms.calls.last, 'mute:u2');

      await tester.tap(find.byKey(const Key('room-leave')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('room-end-confirm')));
      await tester.pumpAndSettle();
      expect(rooms.calls.last, 'end:r-new');
      expect(find.byKey(const Key('room-screen')), findsNothing);
    });

    testWidgets('going live needs Host mode', (tester) async {
      final rooms = FakeRoomsRepository()..openError = apiError(403, 'HOST_ONLY');
      await pumpMatches(tester, matches: FakeMatchesRepository(), rooms: rooms, location: '/rooms');
      await tester.tap(find.byKey(const Key('rooms-go-live')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('go-live-title')), 'Hi');
      await tester.tap(find.byKey(const Key('go-live-start')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('go-live-error')), findsOneWidget);
      expect(find.textContaining('Only Verified Hosts can go live'), findsOneWidget);
    });
  });
}
