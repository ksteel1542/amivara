import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../theme/rose_tokens.g.dart';

/// Screen 5e: verification result (docs/UI_WIREFRAMES.md).
class VerificationResultScreen extends StatelessWidget {
  const VerificationResultScreen({super.key, required this.status, this.attemptsLeft});

  /// passed | pending | manual_review | failed
  final String status;
  final int? attemptsLeft;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final titleColor = theme.brightness == Brightness.dark ? scheme.onSurface : scheme.secondary;

    final (
      Widget badge,
      String title,
      String body,
      String primary,
      String primaryRoute,
      String? secondary,
    ) = switch (status) {
      'passed' => (
        const _GoldBadge(key: Key('gold-badge')),
        "You're verified ✦",
        'Your gold badge is on your profile. Liking and chatting are unlocked. Time to meet someone real.',
        'Continue',
        '/home',
        null,
      ),
      'manual_review' => (
        Icon(Icons.hourglass_top_rounded, size: 72, color: theme.colorScheme.tertiary),
        "We're taking a closer look",
        'A member of our team is reviewing your verification, usually within 24 hours. '
            "We'll let you know. You can keep browsing in the meantime.",
        'OK',
        '/home',
        null,
      ),
      'failed' => (
        Icon(Icons.refresh_rounded, size: 72, color: scheme.primary),
        "We couldn't verify you this time",
        (attemptsLeft ?? 0) > 0
            ? 'Try again in good light, with your face clearly visible, and check your NIN. '
                  '${attemptsLeft == 1 ? '1 try' : '$attemptsLeft tries'} left before a person reviews it.'
            : 'A member of our team will review your verification.',
        (attemptsLeft ?? 0) > 0 ? 'Try again' : 'OK',
        (attemptsLeft ?? 0) > 0 ? '/verify/nin' : '/home',
        (attemptsLeft ?? 0) > 0 ? 'Not now' : null,
      ),
      _ => (
        Icon(Icons.schedule_rounded, size: 72, color: scheme.primary),
        'Almost there',
        "Smile ID is still checking your details. We'll notify you as soon as it's done.",
        'Continue browsing',
        '/home',
        null,
      ),
    };

    return PopScope(
      canPop: false,
      child: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(RoseSpacing.gutterOnboarding),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                const Spacer(),
                Center(child: badge),
                const SizedBox(height: RoseSpacing.s6),
                Text(
                  title,
                  key: const Key('result-title'),
                  textAlign: TextAlign.center,
                  style: theme.textTheme.headlineMedium?.copyWith(color: titleColor),
                ),
                const SizedBox(height: RoseSpacing.s3),
                Text(body, textAlign: TextAlign.center, style: theme.textTheme.bodyLarge),
                const Spacer(),
                FilledButton(onPressed: () => context.go(primaryRoute), child: Text(primary)),
                if (secondary != null) ...<Widget>[
                  const SizedBox(height: RoseSpacing.s2),
                  TextButton(onPressed: () => context.go('/home'), child: Text(secondary)),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The verified badge (AMIVARA_ROSE §5): gold rosette, night check (9.07:1).
class _GoldBadge extends StatelessWidget {
  const _GoldBadge({super.key});

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0.6, end: 1),
      duration: const Duration(milliseconds: 500),
      curve: Curves.easeOutBack,
      builder: (context, scale, child) => Transform.scale(scale: scale, child: child),
      child: Container(
        width: 112,
        height: 112,
        decoration: BoxDecoration(
          color: RoseColors.champagneGold,
          shape: BoxShape.circle,
          boxShadow: <BoxShadow>[
            BoxShadow(color: RoseColors.champagneGold.withValues(alpha: 0.45), blurRadius: 32, spreadRadius: 4),
          ],
        ),
        child: const Icon(Icons.check_rounded, size: 64, color: RoseColors.burgundyBlack),
      ),
    );
  }
}
