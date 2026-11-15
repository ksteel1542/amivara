import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/api_client.dart';
import 'package:amivara/features/wallet/wallet_repository.dart';

import 'matches_test.dart' show pumpMatches;
import 'support/fakes.dart';

/// Milestone 2: the in-chat top-up sheet and the "Payment successful" dialog.
Future<({FakeWalletRepository wallet, FakeCheckoutLauncher checkout, FakeChatRepository chat, FakeChatSocket socket})>
openChat(WidgetTester tester, {FakeWalletRepository? wallet, bool online = true}) async {
  final w = wallet ?? FakeWalletRepository();
  final checkout = FakeCheckoutLauncher();
  final chat = FakeChatRepository();
  final socket = FakeChatSocket(online: online);
  await pumpMatches(
    tester,
    matches: FakeMatchesRepository(matches: [matchOf('m1', name: 'Kunle')]),
    chat: chat,
    socket: socket,
    wallet: w,
    checkout: checkout,
  );
  await tester.tap(find.byKey(const Key('match-m1')));
  await tester.pumpAndSettle();
  return (wallet: w, checkout: checkout, chat: chat, socket: socket);
}

void main() {
  testWidgets('the chat shows the coin balance; tapping it opens the packages in naira', (tester) async {
    await openChat(tester);
    expect(find.byKey(const Key('chat-coins')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('chat-coins')), matching: find.text('100')), findsOneWidget);

    await tester.tap(find.byKey(const Key('chat-coins')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('topup-sheet')), findsOneWidget);
    expect(find.text('Top up coins'), findsOneWidget);
    expect(find.byKey(const Key('topup-first-bonus')), findsOneWidget);
    for (final (coins, price) in [
      ('500', '₦1,000'),
      ('2,000', '₦3,500'),
      ('10,000', '₦15,000'),
      ('30,000', '₦40,000'),
    ]) {
      expect(find.text('$coins coins'), findsOneWidget);
      expect(find.text(price), findsOneWidget);
    }
    expect(find.text('Most popular'), findsOneWidget);
    expect(find.text('+400 bonus coins'), findsOneWidget);
    expect(find.textContaining('Secured by Paystack'), findsOneWidget);
  });

  testWidgets('buying opens Paystack checkout, then shows Payment successful with the new balance', (tester) async {
    final opened = await openChat(tester);
    opened.wallet.statuses.addAll([TopupStatus.pending, TopupStatus.succeeded]);

    await tester.tap(find.byKey(const Key('chat-coins')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('topup-package-2000')));
    await tester.pump();
    await tester.pump();

    expect(opened.wallet.calls, contains('start:p2000:paystack'));
    expect(opened.checkout.opened.single.toString(), 'https://checkout.paystack.test/amv_1');
    expect(find.byKey(const Key('topup-waiting')), findsOneWidget);

    await tester.pump(const Duration(seconds: 3)); // pending
    expect(find.byKey(const Key('payment-success')), findsNothing);
    await tester.pump(const Duration(seconds: 3)); // succeeded
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('topup-sheet')), findsNothing);
    expect(find.byKey(const Key('payment-success')), findsOneWidget);
    expect(find.text('Payment successful'), findsOneWidget);
    expect(find.textContaining('2,400 coins have been added'), findsOneWidget);
    expect(find.textContaining('Your balance is 2,500 coins'), findsOneWidget);

    await tester.tap(find.byKey(const Key('payment-success-done')));
    await tester.pumpAndSettle();
    expect(find.descendant(of: find.byKey(const Key('chat-coins')), matching: find.text('2,500')), findsOneWidget);
  });

  testWidgets("I've paid checks at once; a declined payment returns to the packages", (tester) async {
    final opened = await openChat(tester);
    opened.wallet.statuses.add(TopupStatus.failed);

    await tester.tap(find.byKey(const Key('chat-coins')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('topup-package-500')));
    await tester.pump();
    await tester.pump();
    await tester.tap(find.byKey(const Key('topup-check')));
    await tester.pump();
    await tester.pump();

    expect(opened.wallet.calls.where((c) => c.startsWith('poll:')), hasLength(1));
    expect(find.byKey(const Key('topup-error')), findsOneWidget);
    expect(find.textContaining("didn't go through"), findsOneWidget);
    expect(find.byKey(const Key('topup-package-500')), findsOneWidget);
    expect(find.byKey(const Key('payment-success')), findsNothing);
  });

  testWidgets('a 402 INSUFFICIENT_COINS while sending opens the sheet with the shortfall', (tester) async {
    final opened = await openChat(tester, online: false);
    opened.chat.sendError = const ApiException(402, 'INSUFFICIENT_COINS', "You don't have enough coins.", {
      'balance': 100,
      'required': 150,
    });
    await tester.enterText(find.byKey(const Key('chat-input')), 'Hello!');
    await tester.pump();
    await tester.tap(find.byKey(const Key('chat-send')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('topup-sheet')), findsOneWidget);
    expect(find.text('You need 50 more coins for that.'), findsOneWidget);
  });

  testWidgets('the same error over the live socket opens the sheet too', (tester) async {
    final opened = await openChat(tester);
    opened.socket.push('error', {
      'code': 'INSUFFICIENT_COINS',
      'message': "You don't have enough coins.",
      'details': {'balance': 10, 'required': 40},
    });
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('topup-sheet')), findsOneWidget);
    expect(find.text('You need 30 more coins for that.'), findsOneWidget);
  });

  testWidgets('no packages when this build’s checkout is not offered', (tester) async {
    await openChat(tester, wallet: FakeWalletRepository(providers: const <String>[]));
    await tester.tap(find.byKey(const Key('chat-coins')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('topup-unavailable')), findsOneWidget);
    expect(find.byKey(const Key('topup-package-500')), findsNothing);
  });

  test('naira and thousands formatting', () {
    expect(formatNaira(1000), '₦1,000');
    expect(formatNaira(40000), '₦40,000');
    expect(formatThousands(999), '999');
    expect(formatThousands(1234567), '1,234,567');
  });
}
