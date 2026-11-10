import 'package:flutter/material.dart';
// FlutterConfig is not re-exported by smile_id.dart, so import the generated messages.
import 'package:smile_id/generated/smileid_messages.g.dart' show FlutterConfig;
import 'package:smile_id/smile_id.dart';
import 'package:smile_id/products/biometric/smile_id_biometric_kyc.dart';

import 'verification_repository.dart';

/// Build-time Smile ID SDK settings (never the API key: that stays on the server).
/// `flutter build appbundle --dart-define=SMILE_ID_PARTNER_ID=... --dart-define=SMILE_ID_AUTH_TOKEN=...`
abstract final class SmileIdConfig {
  static const String partnerId = String.fromEnvironment('SMILE_ID_PARTNER_ID');
  static const String authToken = String.fromEnvironment('SMILE_ID_AUTH_TOKEN');
  static const bool sandbox = bool.fromEnvironment('SMILE_ID_SANDBOX', defaultValue: true);

  static bool get present => partnerId.isNotEmpty && authToken.isNotEmpty;
}

/// Runs the identity capture (SmartSelfie liveness + NIN Biometric KYC).
/// The real implementation embeds the Smile ID SDK; tests use a fake.
abstract interface class IdentityCapture {
  /// False when this build has no Smile ID configuration.
  bool get available;

  Widget biometricKyc({
    required VerificationTicket ticket,
    required String nin,
    required DateTime consentGrantedAt,
    required VoidCallback onSubmitted,
    required ValueChanged<String> onError,
  });
}

class SmileIdCapture implements IdentityCapture {
  SmileIdCapture({required this.initialized});

  /// Whether SmileID.initializeWithConfig succeeded at startup.
  final bool initialized;

  /// Called once from main(). Returns false (and the app falls back to
  /// "verification unavailable") when this build has no Smile ID config.
  static Future<bool> initialize() async {
    if (!SmileIdConfig.present) return false;
    try {
      await SmileID.initializeWithConfig(
        config: FlutterConfig(
          partnerId: SmileIdConfig.partnerId,
          authToken: SmileIdConfig.authToken,
          prodBaseUrl: 'https://api.smileidentity.com/',
          sandboxBaseUrl: 'https://testapi.smileidentity.com/',
        ),
        useSandbox: SmileIdConfig.sandbox,
        enableCrashReporting: false,
      );
      return true;
    } on Object {
      return false;
    }
  }

  @override
  bool get available => initialized;

  @override
  Widget biometricKyc({
    required VerificationTicket ticket,
    required String nin,
    required DateTime consentGrantedAt,
    required VoidCallback onSubmitted,
    required ValueChanged<String> onError,
  }) {
    if (ticket.callbackUrl != null) SmileID.setCallbackUrl(callbackUrl: Uri.parse(ticket.callbackUrl!));
    return SmileIDBiometricKYC(
      country: 'NG',
      idType: 'NIN_V2',
      idNumber: nin,
      entered: true, // the NIN was entered on our screen (5c)
      // Our server-issued ids tie this Smile ID job to the verification row.
      userId: ticket.userId,
      jobId: ticket.jobId,
      consentGrantedDate: consentGrantedAt.toUtc().toIso8601String(),
      personalDetailsConsentGranted: true,
      contactInformationConsentGranted: false,
      documentInformationConsentGranted: true,
      allowNewEnroll: true,
      showAttribution: true,
      showInstructions: true,
      onSuccess: (_) => onSubmitted(), // the result itself comes from our API (webhook/poller)
      onError: onError,
    );
  }
}
