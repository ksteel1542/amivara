import '../../core/api_client.dart';

enum OtpChannel { sms, whatsapp }

class OtpChallenge {
  const OtpChallenge({
    required this.challengeId,
    required this.channel,
    required this.expiresIn,
    required this.resendIn,
  });

  final String challengeId;
  final OtpChannel channel;
  final int expiresIn;
  final int resendIn;
}

class TokenPair {
  const TokenPair({required this.accessToken, required this.refreshToken, required this.expiresIn});

  factory TokenPair.fromJson(Map<String, dynamic> json) => TokenPair(
    accessToken: json['access_token'] as String,
    refreshToken: json['refresh_token'] as String,
    expiresIn: (json['expires_in'] as num).toInt(),
  );

  final String accessToken;
  final String refreshToken;
  final int expiresIn;
}

/// Result of a correct code: an existing member is signed in, a new number gets a signup token.
sealed class VerifyResult {
  const VerifyResult();
}

class SignedIn extends VerifyResult {
  const SignedIn(this.tokens);
  final TokenPair tokens;
}

class SignupRequired extends VerifyResult {
  const SignupRequired(this.signupToken);
  final String signupToken;
}

enum Gender { woman, man, nonBinary }

enum DatingIntent { relationship, friendship, casual, notSure }

extension GenderApi on Gender {
  String get api => switch (this) {
    Gender.woman => 'woman',
    Gender.man => 'man',
    Gender.nonBinary => 'non_binary',
  };
}

extension DatingIntentApi on DatingIntent {
  String get api => switch (this) {
    DatingIntent.relationship => 'relationship',
    DatingIntent.friendship => 'friendship',
    DatingIntent.casual => 'casual',
    DatingIntent.notSure => 'not_sure',
  };
}

class OnboardingDetails {
  const OnboardingDetails({
    required this.firstName,
    required this.dateOfBirth,
    required this.gender,
    required this.interestedIn,
    required this.intent,
  });

  final String firstName;

  /// YYYY-MM-DD
  final String dateOfBirth;
  final Gender gender;
  final Set<Gender> interestedIn;
  final DatingIntent intent;
}

class MemberSummary {
  const MemberSummary({required this.firstName, required this.ageVerified});

  final String firstName;
  final bool ageVerified;
}

/// The auth and onboarding endpoints (docs/API.md "Auth" and "Onboarding").
abstract interface class AuthRepository {
  Future<OtpChallenge> requestOtp(String phoneE164, OtpChannel channel);
  Future<VerifyResult> verifyOtp(String challengeId, String code);
  Future<void> ageGate(String signupToken, String dateOfBirth);
  Future<TokenPair> completeOnboarding(String signupToken, OnboardingDetails details);
  Future<TokenPair> refresh(String refreshToken);
  Future<MemberSummary> me(String accessToken);
}

class HttpAuthRepository implements AuthRepository {
  const HttpAuthRepository(this._api);

  final ApiClient _api;

  @override
  Future<OtpChallenge> requestOtp(String phoneE164, OtpChannel channel) async {
    final json = await _api.post(
      '/auth/otp/request',
      body: <String, dynamic>{'phone': phoneE164, 'channel': channel.name},
    );
    return OtpChallenge(
      challengeId: json['challenge_id'] as String,
      channel: json['channel'] == 'whatsapp' ? OtpChannel.whatsapp : OtpChannel.sms,
      expiresIn: (json['expires_in'] as num).toInt(),
      resendIn: (json['resend_in'] as num).toInt(),
    );
  }

  @override
  Future<VerifyResult> verifyOtp(String challengeId, String code) async {
    final json = await _api.post(
      '/auth/otp/verify',
      body: <String, dynamic>{'challenge_id': challengeId, 'code': code},
    );
    return json['status'] == 'signed_in'
        ? SignedIn(TokenPair.fromJson(json))
        : SignupRequired(json['signup_token'] as String);
  }

  @override
  Future<void> ageGate(String signupToken, String dateOfBirth) =>
      _api.post('/onboarding/age-gate', bearer: signupToken, body: <String, dynamic>{'date_of_birth': dateOfBirth});

  @override
  Future<TokenPair> completeOnboarding(String signupToken, OnboardingDetails details) async {
    final json = await _api.post(
      '/onboarding/complete',
      bearer: signupToken,
      body: <String, dynamic>{
        'first_name': details.firstName,
        'date_of_birth': details.dateOfBirth,
        'gender': details.gender.api,
        'interested_in': details.interestedIn.map((g) => g.api).toList(),
        'intent': details.intent.api,
      },
    );
    return TokenPair.fromJson(json);
  }

  @override
  Future<TokenPair> refresh(String refreshToken) async =>
      TokenPair.fromJson(await _api.post('/auth/refresh', body: <String, dynamic>{'refresh_token': refreshToken}));

  @override
  Future<MemberSummary> me(String accessToken) async {
    final json = await _api.get('/me', bearer: accessToken);
    final profile = json['profile'] as Map<String, dynamic>;
    final verification = json['verification'] as Map<String, dynamic>;
    return MemberSummary(firstName: profile['first_name'] as String, ageVerified: verification['age_verified'] as bool);
  }
}
