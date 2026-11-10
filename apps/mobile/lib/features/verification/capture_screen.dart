import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'verification_providers.dart';

/// Screen 5b: SmartSelfie liveness + Biometric KYC, run by the Smile ID SDK.
/// The SDK submits straight to Smile ID; images never pass through AMIVARA.
class CaptureScreen extends ConsumerWidget {
  const CaptureScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final flow = ref.watch(verificationFlowProvider);
    final ticket = flow.ticket;
    final nin = flow.nin;
    if (ticket == null || nin == null) {
      return const Scaffold(body: Center(child: Text('Start verification again.')));
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Selfie check')),
      body: ref
          .read(identityCaptureProvider)
          .biometricKyc(
            ticket: ticket,
            nin: nin,
            consentGrantedAt: flow.consentAt ?? DateTime.now(),
            onSubmitted: () {
              ref.read(verificationFlowProvider.notifier).submitted();
              context.go('/verify/submitting');
            },
            onError: (message) {
              ref.read(verificationFlowProvider.notifier).submitted();
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(SnackBar(content: Text(message.isEmpty ? 'The selfie check was cancelled.' : message)));
              if (context.canPop()) context.pop();
            },
          ),
    );
  }
}
