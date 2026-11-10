import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import 'verification_providers.dart';
import 'verification_repository.dart';

/// Screen 5d: "Checking your details…". Polls GET /verification/status
/// (the API resolves via the Smile ID webhook or its job_status fallback).
/// Back is disabled; after [maxWait] the member can continue browsing and the
/// result arrives later.
class SubmittingScreen extends ConsumerStatefulWidget {
  const SubmittingScreen({
    super.key,
    this.interval = const Duration(seconds: 3),
    this.maxWait = const Duration(seconds: 60),
  });

  final Duration interval;
  final Duration maxWait;

  @override
  ConsumerState<SubmittingScreen> createState() => _SubmittingScreenState();
}

class _SubmittingScreenState extends ConsumerState<SubmittingScreen> {
  Timer? _timer;
  int _ticks = 0;
  bool _checking = false;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(widget.interval, (_) => _check());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _check() async {
    if (_checking || !mounted) return;
    _checking = true;
    _ticks++;
    try {
      final token = ref.read(sessionProvider)!.accessToken;
      final status = await ref.read(verificationRepositoryProvider).status(token);
      if (!mounted) return;
      final done = status.outcome != VerificationOutcome.pending && status.outcome != VerificationOutcome.none;
      // Counted in polls (not wall-clock time), so it is deterministic and testable.
      final timedOut = _ticks * widget.interval.inMilliseconds >= widget.maxWait.inMilliseconds;
      if (done || timedOut) {
        _timer?.cancel();
        ref.read(verificationFlowProvider.notifier).reset();
        final query = done ? _query(status.outcome) : 'pending';
        context.go('/verify/result?status=$query&attempts=${status.attemptsLeft}');
      }
    } on ApiException {
      // Offline for a moment: keep trying until maxWait, then let the member browse.
      if (mounted && _ticks * widget.interval.inMilliseconds >= widget.maxWait.inMilliseconds) {
        _timer?.cancel();
        context.go('/verify/result?status=pending');
      }
    } finally {
      _checking = false;
    }
  }

  static String _query(VerificationOutcome o) => switch (o) {
    VerificationOutcome.passed => 'passed',
    VerificationOutcome.failed => 'failed',
    VerificationOutcome.manualReview => 'manual_review',
    VerificationOutcome.expired => 'failed',
    _ => 'pending',
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return PopScope(
      canPop: false,
      child: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(RoseSpacing.gutterOnboarding),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                const CircularProgressIndicator(),
                const SizedBox(height: RoseSpacing.s6),
                Text('Checking your details…', style: theme.textTheme.headlineSmall, textAlign: TextAlign.center),
                const SizedBox(height: RoseSpacing.s2),
                Text(
                  'This usually takes under a minute. You can keep the app open or come back later.',
                  style: theme.textTheme.bodyLarge,
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
