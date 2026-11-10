import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/secure_store.dart';
import 'package:amivara/features/auth/auth_repository.dart';
import 'package:amivara/features/auth/nigerian_phone.dart';
import 'package:amivara/features/onboarding/age.dart';

import 'support/fakes.dart';

/// The test font is wider than the real fonts, so scroll targets into view before tapping.
Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pump();
}

Future<void> goToPhone(WidgetTester tester) async {
  await tapVisible(tester, find.text('Create account'));
  await tester.pumpAndSettle();
}

Future<void> enterPhoneAndSend(WidgetTester tester, String number) async {
  await tester.enterText(find.byKey(const Key('phone-field')), number);
  await tester.pump();
  await tester.tap(find.text('Send code'));
  await tester.pumpAndSettle();
}

Future<void> enterCode(WidgetTester tester, String code) async {
  await tester.enterText(find.byKey(const Key('otp-field')), code);
  await tester.pumpAndSettle();
}

Future<void> enterDob(WidgetTester tester, {required int day, required int month, required int year}) async {
  await tester.enterText(find.byKey(const Key('dob-day')), '$day');
  await tester.tap(find.byKey(const Key('dob-month')));
  await tester.pumpAndSettle();
  const months = <String>[
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  await tester.tap(find.text(months[month - 1]).last);
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const Key('dob-year')), '$year');
  await tester.pump();
}

void main() {
  group('NigerianPhone', () {
    test('accepts local and international formats', () {
      expect(NigerianPhone.toE164('0801 234 5678'), '+2348012345678');
      expect(NigerianPhone.toE164('8012345678'), '+2348012345678');
      expect(NigerianPhone.toE164('+234 801 234 5678'), '+2348012345678');
      expect(NigerianPhone.toE164('2347031234567'), '+2347031234567');
    });

    test('rejects landlines, short and foreign numbers', () {
      expect(NigerianPhone.toE164('0801234'), isNull);
      expect(NigerianPhone.toE164('012345678'), isNull); // Lagos landline
      expect(NigerianPhone.toE164('+447911123456'), isNull);
    });

    test('formats for display', () {
      expect(NigerianPhone.format('08012345678'), '801 234 5678');
    });
  });

  group('AgeRules (mirrors the API)', () {
    test('rejects impossible dates', () {
      expect(AgeRules.date(2001, 2, 29), isNull);
      expect(AgeRules.date(2000, 2, 29), isNotNull);
    });

    test('an 18th birthday counts only once it is the birthday in both Lagos and UTC', () {
      final birth = AgeRules.date(2008, 11, 10)!;
      expect(AgeRules.currentAge(birth, now: DateTime.utc(2026, 11, 9, 23, 30)), 17);
      expect(AgeRules.currentAge(birth, now: DateTime.utc(2026, 11, 10)), 18);
    });
  });

  testWidgets('Send code stays disabled until the number is a valid Nigerian mobile', (tester) async {
    final repo = FakeAuthRepository();
    await pumpApp(tester, repo: repo);
    await goToPhone(tester);

    FilledButton sendButton() => tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Send code'));
    expect(sendButton().onPressed, isNull);
    await tester.enterText(find.byKey(const Key('phone-field')), '0801 234');
    await tester.pump();
    expect(sendButton().onPressed, isNull);
    await tester.enterText(find.byKey(const Key('phone-field')), '0801 234 5678');
    await tester.pump();
    expect(sendButton().onPressed, isNotNull);
  });

  testWidgets('rate limits show a countdown message', (tester) async {
    final repo = FakeAuthRepository()..then(apiError(429, 'OTP_RATE_LIMITED', <String, dynamic>{'retry_after': 75}));
    await pumpApp(tester, repo: repo);
    await goToPhone(tester);
    await enterPhoneAndSend(tester, '08012345678');
    expect(find.text('Too many tries. Please wait 1:15.'), findsOneWidget);
  });

  testWidgets('new member: phone → code → date of birth → basics → home', (tester) async {
    final store = MemoryStore();
    final repo = FakeAuthRepository()
      ..then(kChallenge)
      ..then(const SignupRequired('signup-token'))
      ..then(ok)
      ..then(kTokens);
    await pumpApp(tester, repo: repo, store: store);

    await goToPhone(tester);
    await enterPhoneAndSend(tester, '0801 234 5678');
    expect(repo.lastPhone, '+2348012345678');
    expect(find.text('Enter your code'), findsOneWidget);
    expect(find.text('Resend code in 1:00'), findsOneWidget);

    await enterCode(tester, '123456'); // auto-submits on the sixth digit
    expect(repo.lastCode, '123456');
    expect(find.text("When's your birthday?"), findsOneWidget);

    await enterDob(tester, day: 14, month: 3, year: 1999);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Born 14 March 1999'), findsOneWidget);
    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();
    expect(repo.lastDateOfBirth, '1999-03-14');

    expect(find.text('A little about you'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('first-name')), 'Adaeze');
    await tapVisible(tester, find.text('Woman'));
    await tapVisible(tester, find.text('Men'));
    await tapVisible(tester, find.text('A relationship'));
    await tester.pump();
    await tapVisible(tester, find.text('Create my account'));
    await tester.pumpAndSettle();

    expect(repo.lastDetails!.firstName, 'Adaeze');
    expect(repo.lastDetails!.gender, Gender.woman);
    expect(repo.lastDetails!.interestedIn, <Gender>{Gender.man});
    expect(repo.lastDetails!.dateOfBirth, '1999-03-14');
    expect(store.values[StoreKeys.refreshToken], 'refresh-token');
    // Onboarding continues to photos (PRD §5.1 step 4).
    expect(find.text('Add your photos'), findsOneWidget);
  });

  testWidgets('existing member signs straight in', (tester) async {
    final repo = FakeAuthRepository()
      ..then(kChallenge)
      ..then(const SignedIn(kTokens));
    await pumpApp(tester, repo: repo);
    await goToPhone(tester);
    await enterPhoneAndSend(tester, '08012345678');
    await enterCode(tester, '654321');
    expect(find.text("You're in, Adaeze"), findsOneWidget);
  });

  testWidgets('a wrong code shows the tries left and clears the boxes', (tester) async {
    final repo = FakeAuthRepository()
      ..then(kChallenge)
      ..then(apiError(400, 'OTP_INVALID', <String, dynamic>{'attempts_left': 3}));
    await pumpApp(tester, repo: repo);
    await goToPhone(tester);
    await enterPhoneAndSend(tester, '08012345678');
    await enterCode(tester, '000000');
    expect(find.text("That code isn't right. 3 tries left."), findsOneWidget);
    expect(find.text('Enter your code'), findsOneWidget);
  });

  testWidgets('under 18: the server is told, and Screen 3x has no way back', (tester) async {
    final repo = FakeAuthRepository()
      ..then(kChallenge)
      ..then(const SignupRequired('signup-token'))
      ..then(apiError(403, 'UNDERAGE'));
    await pumpApp(tester, repo: repo);
    await goToPhone(tester);
    await enterPhoneAndSend(tester, '08012345678');
    await enterCode(tester, '123456');

    final now = DateTime.now();
    await enterDob(tester, day: 1, month: 1, year: now.year - 16);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(repo.calls, contains('ageGate')); // reported, so the phone and device get blocked
    expect(find.text("You're 16"), findsNothing); // no confirmation dialog for minors
    expect(find.text('AMIVARA is for adults only'), findsOneWidget);
    expect(find.byKey(const Key('not-eligible-close')), findsOneWidget);

    // System back does nothing.
    final popped = await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(popped, isTrue);
    expect(find.text('AMIVARA is for adults only'), findsOneWidget);
  });

  testWidgets('/home without a session redirects to the welcome screen', (tester) async {
    final repo = FakeAuthRepository();
    await pumpApp(tester, repo: repo, initialLocation: '/home');
    expect(find.text('Create account'), findsOneWidget);
  });
}
