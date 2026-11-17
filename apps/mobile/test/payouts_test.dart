import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/features/hosts/host_screen.dart';
import 'package:amivara/features/hosts/payouts_repository.dart';

import 'settings_test.dart' show pumpSettings;
import 'support/fakes.dart';

const gtb = PayoutAccount(
  bankCode: '058',
  bankName: 'Guaranty Trust Bank',
  accountLast4: '6789',
  accountName: 'ADA CHIOMA OKAFOR',
);

Future<void> openHostDashboard(WidgetTester tester, FakePayoutsRepository payouts) async {
  await pumpSettings(
    tester,
    host: FakeHostRepository(state: const HostState(status: 'active', pendingCoins: 1250, availableCoins: 6000)),
    payouts: payouts,
  );
  await tester.scrollUntilVisible(find.byKey(const Key('host-tile')), 200);
  await tester.tap(find.byKey(const Key('host-tile')));
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, Key key) => tester.widget<Text>(find.byKey(key)).data!;

void main() {
  test('naira formatting', () {
    expect(naira(600000), '₦6,000');
    expect(naira(123456789), '₦1,234,567.89');
    expect(naira(100), '₦1');
  });

  testWidgets('the Host dashboard shows held vs available in naira; no bank account, no withdrawal', (tester) async {
    await openHostDashboard(tester, FakePayoutsRepository());
    await tester.scrollUntilVisible(find.byKey(const Key('payout-withdraw')), 200);
    expect(textOf(tester, const Key('payout-pending-naira')), '₦1,250');
    expect(textOf(tester, const Key('payout-available-naira')), '₦6,000');
    expect(find.text('1 coin = ₦1 · minimum withdrawal ₦5,000'), findsOneWidget);
    expect(find.byKey(const Key('payout-add-account')), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('payout-withdraw'))).onPressed, isNull);
  });

  testWidgets('bank account setup: pick a bank, 10 digits, the name is looked up, then saved', (tester) async {
    final payouts = FakePayoutsRepository();
    await openHostDashboard(tester, payouts);
    await tester.scrollUntilVisible(find.byKey(const Key('payout-add-account')), 200);
    await tester.ensureVisible(find.byKey(const Key('payout-add-account')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('payout-add-account')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('bank-account-screen')), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('bank-save'))).onPressed, isNull);

    await tester.tap(find.byKey(const Key('bank-dropdown')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Guaranty Trust Bank').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('bank-account-number')), '0000000000');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('bank-error')), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('bank-save'))).onPressed, isNull);

    await tester.enterText(find.byKey(const Key('bank-account-number')), '0123456789');
    await tester.pumpAndSettle();
    expect(textOf(tester, const Key('bank-resolved-name')), 'ADA CHIOMA OKAFOR');
    await tester.tap(find.byKey(const Key('bank-save')));
    await tester.pumpAndSettle();
    expect(payouts.calls.last, 'save:058:0123456789');
    expect(find.byKey(const Key('bank-account-screen')), findsNothing);
    await tester.scrollUntilVisible(find.byKey(const Key('payout-account')), 200);
    expect(find.text('Guaranty Trust Bank ••6789'), findsOneWidget);
  });

  testWidgets('withdraw: the sheet shows the amount and the bank; history shows it processing', (tester) async {
    final payouts = FakePayoutsRepository(account: gtb);
    await openHostDashboard(tester, payouts);
    await tester.scrollUntilVisible(find.byKey(const Key('payout-withdraw')), 200);
    expect(find.text('Withdraw ₦6,000'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('payout-withdraw')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('payout-withdraw')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('withdraw-sheet')), findsOneWidget);
    expect(textOf(tester, const Key('withdraw-amount')), '₦6,000');
    expect(textOf(tester, const Key('withdraw-destination')), 'Guaranty Trust Bank ••6789');

    await tester.ensureVisible(find.byKey(const Key('withdraw-confirm')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('withdraw-confirm')));
    await tester.pumpAndSettle();
    expect(payouts.calls, ['withdraw']);
    expect(find.text('Payout of ₦6,000 started. Most arrive within minutes.'), findsOneWidget);
    await tester.scrollUntilVisible(find.byKey(const Key('payout-p1')), 200);
    expect(
      find.descendant(of: find.byKey(const Key('payout-status-p1')), matching: find.text('Processing')),
      findsOneWidget,
    );
    expect(find.text('Payout in progress'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('payout-withdraw'))).onPressed, isNull);
  });

  testWidgets('a failed payout says the coins are back; the safety switch pauses withdrawals', (tester) async {
    final payouts = FakePayoutsRepository(account: gtb)..withdrawStatus = 'failed';
    await openHostDashboard(tester, payouts);
    await tester.scrollUntilVisible(find.byKey(const Key('payout-withdraw')), 200);
    await tester.ensureVisible(find.byKey(const Key('payout-withdraw')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('payout-withdraw')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('withdraw-confirm')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('withdraw-confirm')));
    await tester.pumpAndSettle();
    expect(find.text("That payout didn't go through. Your coins are back in your balance."), findsOneWidget);
    await tester.scrollUntilVisible(find.byKey(const Key('payout-p1')), 200);
    expect(
      find.descendant(of: find.byKey(const Key('payout-status-p1')), matching: find.text('Failed')),
      findsOneWidget,
    );
  });

  testWidgets('withdrawals paused: explained, and the button is off', (tester) async {
    await openHostDashboard(tester, FakePayoutsRepository(account: gtb, enabled: false));
    await tester.scrollUntilVisible(find.byKey(const Key('payouts-paused')), 200);
    expect(tester.widget<FilledButton>(find.byKey(const Key('payout-withdraw'))).onPressed, isNull);
  });
}
