import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../theme/rose_tokens.g.dart';

/// Screen 4: Smile ID pre-check explainer, "Verified, not anonymous"
/// (docs/UI_WIREFRAMES.md). Explains why we verify, what happens and what we
/// keep, before any camera permission is asked for.
///
/// "I'll do it later" leads to browse-only mode (PRD §5.3a). "Start
/// verification" opens the Smile ID flow (NIN → SmartSelfie → result).
class VerifyIntroScreen extends StatelessWidget {
  const VerifyIntroScreen({super.key, this.onStartVerification});

  /// Test hook; by default Start opens the NIN screen.
  final VoidCallback? onStartVerification;

  void _start(BuildContext context) {
    if (onStartVerification != null) {
      onStartVerification!();
      return;
    }
    context.push('/verify/nin');
  }

  void _showSmileIdDetails(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) {
        final theme = Theme.of(context);
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(RoseSpacing.s6, 0, RoseSpacing.s6, RoseSpacing.s6),
            child: Column(
              key: const Key('smile-id-sheet'),
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Secured by Smile ID', style: theme.textTheme.headlineSmall),
                const SizedBox(height: RoseSpacing.s4),
                const _Bullet(
                  'Smile ID is an identity verification provider used by banks and fintechs across Africa.',
                ),
                const _Bullet(
                  'Your NIN is checked against the official NIMC record, and your selfie against the photo on it.',
                ),
                const _Bullet('AMIVARA receives only the result: verified or not, and your age range.'),
                const _Bullet(
                  "We never see or store your ID photo or your full NIN. Smile ID's own storage is governed by its data agreement with us.",
                ),
                const SizedBox(height: RoseSpacing.s2),
                Text(
                  'Details are in our Privacy Policy.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final titleColor = theme.brightness == Brightness.dark ? scheme.onSurface : scheme.secondary;

    return Scaffold(
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  RoseSpacing.gutterOnboarding,
                  RoseSpacing.s8,
                  RoseSpacing.gutterOnboarding,
                  RoseSpacing.s6,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    // The gold rosette is reserved for verified members (AMIVARA_ROSE §5);
                    // shown here so the badge reads as "trust" before it's earned.
                    Center(
                      child: Container(
                        width: 96,
                        height: 96,
                        decoration: const BoxDecoration(color: RoseColors.champagneGold, shape: BoxShape.circle),
                        child: const Icon(Icons.check_rounded, size: 52, color: RoseColors.burgundyBlack),
                      ),
                    ),
                    const SizedBox(height: RoseSpacing.s6),
                    Text(
                      'Verified, not anonymous.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineLarge?.copyWith(color: titleColor),
                    ),
                    const SizedBox(height: RoseSpacing.s3),
                    Text(
                      "Everyone on AMIVARA proves they're a real adult. It takes about 2 minutes.",
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyLarge,
                    ),
                    const SizedBox(height: RoseSpacing.s6),
                    const _Step(
                      number: 1,
                      title: 'Take a quick selfie',
                      body: "A short check that it's really you, live.",
                    ),
                    const _Step(
                      number: 2,
                      title: 'Confirm your ID',
                      body: "Your NIN, or a photo of your passport, licence or voter's card.",
                    ),
                    const _Step(number: 3, title: 'Get your gold badge', body: 'Then you can like and chat.'),
                    const SizedBox(height: RoseSpacing.s4),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(RoseSpacing.s4),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Row(
                              children: <Widget>[
                                Icon(Icons.lock_outline, size: 18, color: scheme.tertiary),
                                const SizedBox(width: RoseSpacing.s2),
                                Text('What we keep', style: theme.textTheme.titleMedium),
                              ],
                            ),
                            const SizedBox(height: RoseSpacing.s2),
                            const Text(
                              'Only "verified 18+" and your age range. We never store your ID photo or full NIN.',
                            ),
                            Align(
                              alignment: Alignment.centerLeft,
                              child: TextButton(
                                key: const Key('smile-id-details'),
                                onPressed: () => _showSmileIdDetails(context),
                                child: const Text('Secured by Smile ID ›'),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                RoseSpacing.gutterOnboarding,
                RoseSpacing.s2,
                RoseSpacing.gutterOnboarding,
                RoseSpacing.buttonBottomInset,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  FilledButton(onPressed: () => _start(context), child: const Text('Start verification')),
                  const SizedBox(height: RoseSpacing.s2),
                  TextButton(onPressed: () => context.go('/home'), child: const Text("I'll do it later")),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.number, required this.title, required this.body});

  final int number;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: RoseSpacing.s4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          CircleAvatar(
            radius: 14,
            backgroundColor: theme.colorScheme.primaryContainer,
            child: Text(
              '$number',
              style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.onPrimaryContainer),
            ),
          ),
          const SizedBox(width: RoseSpacing.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title, style: theme.textTheme.titleMedium),
                Text(body, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Bullet extends StatelessWidget {
  const _Bullet(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: RoseSpacing.s2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('•  '),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}
