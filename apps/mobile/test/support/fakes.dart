import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/api_client.dart';
import 'package:amivara/core/secure_store.dart';
import 'package:amivara/features/auth/auth_providers.dart';
import 'package:amivara/features/auth/auth_repository.dart';
import 'package:amivara/main.dart';

/// Scriptable AuthRepository: each call records its arguments and returns
/// (or throws) whatever the test queued.
class FakeAuthRepository implements AuthRepository {
  final List<String> calls = <String>[];
  final List<Object> _results = <Object>[];

  String? lastPhone;
  OtpChannel? lastChannel;
  String? lastCode;
  String? lastDateOfBirth;
  OnboardingDetails? lastDetails;

  /// Queue a value to return or an [ApiException] to throw, in call order.
  void then(Object result) => _results.add(result);

  T _next<T>() {
    if (_results.isEmpty) throw StateError('FakeAuthRepository: no result queued (calls: $calls)');
    final r = _results.removeAt(0);
    if (r is Exception) throw r;
    return r as T;
  }

  @override
  Future<OtpChallenge> requestOtp(String phoneE164, OtpChannel channel) async {
    calls.add('requestOtp');
    lastPhone = phoneE164;
    lastChannel = channel;
    return _next<OtpChallenge>();
  }

  @override
  Future<VerifyResult> verifyOtp(String challengeId, String code) async {
    calls.add('verifyOtp');
    lastCode = code;
    return _next<VerifyResult>();
  }

  @override
  Future<void> ageGate(String signupToken, String dateOfBirth) async {
    calls.add('ageGate');
    lastDateOfBirth = dateOfBirth;
    _next<Object>();
  }

  @override
  Future<TokenPair> completeOnboarding(String signupToken, OnboardingDetails details) async {
    calls.add('completeOnboarding');
    lastDetails = details;
    return _next<TokenPair>();
  }

  @override
  Future<TokenPair> refresh(String refreshToken) async {
    calls.add('refresh');
    return _next<TokenPair>();
  }

  @override
  Future<MemberSummary> me(String accessToken) async {
    calls.add('me');
    return const MemberSummary(firstName: 'Adaeze', ageVerified: false);
  }
}

const OtpChallenge kChallenge = OtpChallenge(challengeId: 'c-1', channel: OtpChannel.sms, expiresIn: 300, resendIn: 60);
const TokenPair kTokens = TokenPair(accessToken: 'access', refreshToken: 'refresh-token', expiresIn: 900);

/// Ok marker for void calls (ageGate).
const Object ok = 'ok';

ApiException apiError(int status, String code, [Map<String, dynamic> details = const <String, dynamic>{}]) =>
    ApiException(status, code, code, details);

/// Pumps the real app (router + theme) at the 360 x 800dp reference frame.
Future<void> pumpApp(
  WidgetTester tester, {
  required FakeAuthRepository repo,
  MemoryStore? store,
  String initialLocation = '/',
  List<dynamic> extraOverrides = const <dynamic>[],
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authRepositoryProvider.overrideWithValue(repo),
        secureStoreProvider.overrideWithValue(store ?? MemoryStore()),
        ...extraOverrides.cast(),
      ],
      child: AmivaraApp(initialLocation: initialLocation),
    ),
  );
  await tester.pumpAndSettle();
}
