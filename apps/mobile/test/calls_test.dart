import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/features/calls/call_repository.dart';

import 'matches_test.dart' show pumpMatches;
import 'support/fakes.dart';

const paidQuote = CallQuote(available: true, allowed: true, paid: true, voiceRate: 30, videoRate: 60);

class CallRig {
  CallRig({CallQuote quote = paidQuote})
    : calls = FakeCallRepository(quoteResult: quote),
      signalling = FakeChatSocket(),
      engine = FakeCallEngine();

  final FakeCallRepository calls;

  /// The app-wide socket the call events arrive on.
  final FakeChatSocket signalling;
  final FakeCallEngine engine;
}

/// Opens the chat with Kunle (match m1), with calls wired to fakes.
Future<CallRig> openChatWithCalls(WidgetTester tester, {CallRig? rig, FakeWalletRepository? wallet}) async {
  final r = rig ?? CallRig();
  await pumpMatches(
    tester,
    matches: FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]),
    calls: r.calls,
    callSocket: r.signalling,
    engine: r.engine,
    wallet: wallet,
  );
  await tester.tap(find.byKey(const Key('match-m1')));
  await tester.pumpAndSettle();
  return r;
}

String tooltipOf(WidgetTester tester, Key key) => tester.widget<IconButton>(find.byKey(key)).tooltip!;

void main() {
  testWidgets('the chat header offers voice and video calls with the price per minute', (tester) async {
    await openChatWithCalls(tester);
    expect(tooltipOf(tester, const Key('chat-voice-call')), 'Voice call · 30 coins/min');
    expect(tooltipOf(tester, const Key('chat-video-call')), 'Video call · 60 coins/min');
  });

  testWidgets('no call buttons when either member is unverified or calls are off', (tester) async {
    await openChatWithCalls(
      tester,
      rig: CallRig(quote: const CallQuote(available: true, allowed: false, paid: false, voiceRate: 0, videoRate: 0)),
    );
    expect(find.byKey(const Key('chat-voice-call')), findsNothing);
    expect(find.byKey(const Key('chat-video-call')), findsNothing);
  });

  testWidgets('calling a Host: ringing, answered, billed per minute, then hang up', (tester) async {
    final rig = CallRig();
    rig.calls
      ..rate = 30
      ..joinBalance = 70;
    await openChatWithCalls(tester, rig: rig);

    await tester.tap(find.byKey(const Key('chat-voice-call')));
    await tester.pumpAndSettle();
    expect(rig.calls.calls, ['start:m1:voice']);
    expect(find.byKey(const Key('call-screen')), findsOneWidget);
    expect(find.text('Kunle'), findsOneWidget);
    expect(find.text('Calling…'), findsOneWidget);
    expect(find.text('30 coins/min'), findsOneWidget);

    rig.signalling.push('call:accept', {'call': callJson('c1', status: 'active', rate: 30)});
    await tester.pumpAndSettle();
    expect(rig.calls.calls.last, 'join:c1');
    expect(rig.engine.log.first, 'connect:voice');
    expect(find.byKey(const Key('call-timer')), findsOneWidget);
    expect(find.text('70 coins · 30 coins/min'), findsOneWidget);

    rig.signalling.push('call:billed', {'call_id': 'c1', 'billed_minutes': 2, 'total_coins_billed': 60, 'balance': 40});
    await tester.pumpAndSettle();
    expect(find.text('40 coins · 30 coins/min'), findsOneWidget);
    expect(find.byKey(const Key('call-low-balance')), findsNothing);

    await tester.tap(find.byKey(const Key('call-mic')));
    await tester.pump();
    expect(rig.engine.log.last, 'mic:false');
    expect(find.text('Unmute'), findsOneWidget);
    await tester.tap(find.byKey(const Key('call-speaker')));
    await tester.pump();
    expect(rig.engine.log.last, 'speaker:true');

    await tester.tap(find.byKey(const Key('call-end')));
    await tester.pump();
    expect(rig.calls.calls.last, 'end:c1');
    expect(rig.engine.log.last, 'disconnect');
    expect(find.text('Call ended'), findsOneWidget);
    await tester.pump(const Duration(seconds: 3)); // closes itself
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('call-screen')), findsNothing);
  });

  testWidgets('not enough coins for the first minute opens the top-up sheet', (tester) async {
    final rig = CallRig();
    rig.calls.startError = apiError(402, 'INSUFFICIENT_COINS', {'balance': 20, 'required': 60});
    await openChatWithCalls(tester, rig: rig);
    await tester.tap(find.byKey(const Key('chat-video-call')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('topup-sheet')), findsOneWidget);
    expect(find.text('You need 40 more coins for that.'), findsOneWidget);
    expect(find.byKey(const Key('call-screen')), findsNothing);
  });

  testWidgets('low balance warning, then cut off: the top-up sheet opens', (tester) async {
    final rig = CallRig();
    rig.calls
      ..rate = 60
      ..joinBalance = 10;
    await openChatWithCalls(tester, rig: rig);
    await tester.tap(find.byKey(const Key('chat-video-call')));
    await tester.pumpAndSettle();
    rig.signalling.push('call:accept', {'call': callJson('c1', status: 'active', rate: 60, type: 'video')});
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('remote-video')), findsOneWidget);
    expect(find.byKey(const Key('local-video')), findsOneWidget);

    rig.signalling.push('call:low_balance', {'call_id': 'c1', 'balance': 10, 'required': 60, 'seconds_left': 55});
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('call-low-balance')), findsOneWidget);

    rig.signalling.push('call:end', {
      'call': callJson('c1', status: 'insufficient_coins', rate: 60, type: 'video'),
      'top_up': {'balance': 10, 'required': 60},
    });
    await tester.pumpAndSettle();
    expect(find.text('Call ended: you ran out of coins'), findsOneWidget);
    expect(find.byKey(const Key('topup-sheet')), findsOneWidget);
    expect(find.text('You need 50 more coins for that.'), findsOneWidget);
    expect(rig.engine.log.last, 'disconnect');
  });

  testWidgets('an incoming video call rings on any screen; accept, flip the camera, they hang up', (tester) async {
    final rig = await openChatWithCalls(tester);
    rig.signalling.push('call:ring', {
      'call': callJson('c9', caller: false, type: 'video', rate: 60),
      'caller': {'id': 'user-m1', 'first_name': 'Kunle'},
    });
    await tester.pumpAndSettle();
    expect(find.text('Incoming video call'), findsOneWidget);
    expect(find.text('Paid call · 60 coins/min'), findsOneWidget);

    await tester.tap(find.byKey(const Key('call-accept')));
    await tester.pumpAndSettle();
    expect(rig.calls.calls.last, 'accept:c9');
    expect(rig.engine.log.first, 'connect:video');
    await tester.tap(find.byKey(const Key('call-flip')));
    await tester.pump();
    expect(rig.engine.log.last, 'front:false');
    await tester.tap(find.byKey(const Key('call-camera')));
    await tester.pump();
    expect(rig.engine.log.last, 'camera:false');

    rig.signalling.push('call:end', {'call': callJson('c9', status: 'ended', caller: false, type: 'video')});
    await tester.pumpAndSettle();
    expect(find.text('Call ended'), findsOneWidget);
    expect(find.byKey(const Key('topup-sheet')), findsNothing); // the callee never pays
  });

  testWidgets('declining an incoming call', (tester) async {
    final rig = await openChatWithCalls(tester);
    rig.signalling.push('call:ring', {
      'call': callJson('c5', caller: false),
      'caller': {'id': 'user-m1', 'first_name': 'Kunle'},
    });
    await tester.pumpAndSettle();
    expect(find.text('Incoming voice call'), findsOneWidget);
    await tester.tap(find.byKey(const Key('call-decline')));
    await tester.pump();
    expect(rig.calls.calls.last, 'decline:c5');
    expect(find.text('Call declined'), findsOneWidget);
    expect(rig.engine.log, isEmpty);
  });
}
