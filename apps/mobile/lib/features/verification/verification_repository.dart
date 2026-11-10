import '../../core/api_client.dart';

/// POST /verification/sessions: our Smile ID job ids + a server-made signature.
class VerificationTicket {
  const VerificationTicket({
    required this.verificationId,
    required this.userId,
    required this.jobId,
    required this.jobType,
    required this.callbackUrl,
    required this.sandbox,
    required this.attemptsLeft,
  });

  factory VerificationTicket.fromJson(Map<String, dynamic> json) {
    final params = json['partner_params'] as Map<String, dynamic>;
    return VerificationTicket(
      verificationId: json['verification_id'] as String,
      userId: params['user_id'] as String,
      jobId: params['job_id'] as String,
      jobType: (params['job_type'] as num).toInt(),
      callbackUrl: json['callback_url'] as String?,
      sandbox: json['environment'] == 'sandbox',
      attemptsLeft: (json['attempts_left'] as num).toInt(),
    );
  }

  final String verificationId;
  final String userId;
  final String jobId;
  final int jobType;
  final String? callbackUrl;
  final bool sandbox;
  final int attemptsLeft;
}

enum VerificationOutcome { pending, passed, failed, manualReview, expired, none }

class VerificationStatus {
  const VerificationStatus({required this.ageVerified, required this.outcome, required this.attemptsLeft, this.reason});

  factory VerificationStatus.fromJson(Map<String, dynamic> json) {
    final latest = json['latest'] as Map<String, dynamic>?;
    return VerificationStatus(
      ageVerified: json['age_verified'] as bool,
      outcome: switch (latest?['status']) {
        'pending' => VerificationOutcome.pending,
        'passed' => VerificationOutcome.passed,
        'failed' => VerificationOutcome.failed,
        'manual_review' => VerificationOutcome.manualReview,
        'expired' => VerificationOutcome.expired,
        _ => VerificationOutcome.none,
      },
      reason: latest?['reason'] as String?,
      attemptsLeft: (json['attempts_left'] as num).toInt(),
    );
  }

  final bool ageVerified;
  final VerificationOutcome outcome;
  final String? reason;
  final int attemptsLeft;
}

abstract interface class VerificationRepository {
  Future<VerificationTicket> startSession(String accessToken);
  Future<VerificationStatus> status(String accessToken);
}

class HttpVerificationRepository implements VerificationRepository {
  const HttpVerificationRepository(this._api);

  final ApiClient _api;

  @override
  Future<VerificationTicket> startSession(String accessToken) async => VerificationTicket.fromJson(
    await _api.post('/verification/sessions', bearer: accessToken, body: <String, dynamic>{'method': 'biometric_kyc'}),
  );

  @override
  Future<VerificationStatus> status(String accessToken) async =>
      VerificationStatus.fromJson(await _api.get('/verification/status', bearer: accessToken));
}
