import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'identity_capture.dart';
import 'verification_repository.dart';

/// Overridden in main.dart and in tests.
final verificationRepositoryProvider = Provider<VerificationRepository>(
  (ref) => throw UnimplementedError('override in main'),
);
final identityCaptureProvider = Provider<IdentityCapture>((ref) => SmileIdCapture(initialized: false));

/// In-progress verification. The NIN lives here, in memory only, between
/// screen 5c and the capture screen; it is never stored or sent to our API.
class VerificationFlowState {
  const VerificationFlowState({this.ticket, this.nin, this.consentAt});

  final VerificationTicket? ticket;
  final String? nin;
  final DateTime? consentAt;
}

class VerificationFlow extends Notifier<VerificationFlowState> {
  @override
  VerificationFlowState build() => const VerificationFlowState();

  void ready(VerificationTicket ticket, String nin, DateTime consentAt) =>
      state = VerificationFlowState(ticket: ticket, nin: nin, consentAt: consentAt);

  /// Called once the SDK has submitted: forget the NIN immediately.
  void submitted() => state = VerificationFlowState(ticket: state.ticket);

  void reset() => state = const VerificationFlowState();
}

final verificationFlowProvider = NotifierProvider<VerificationFlow, VerificationFlowState>(VerificationFlow.new);
