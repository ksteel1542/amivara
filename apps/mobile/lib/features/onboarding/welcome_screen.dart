import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../theme/rose_tokens.g.dart';

/// Screen 1: Welcome & warm brand introduction (docs/UI_WIREFRAMES.md).
///
/// Skeleton only: the hero photo, monogram artwork and navigation to phone
/// authentication arrive with the Stage 4 onboarding sprint.
///
/// The hero takes ~48% of the screen (so both CTAs clear the gesture bar on a 360 x 800dp phone). Below it the content fills the remaining
/// height, with the CTAs pinned to the bottom, and scrolls instead of
/// overflowing on short screens or at large font scales (up to 200%).
class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final isDark = theme.brightness == Brightness.dark;

    return Scaffold(
      body: LayoutBuilder(
        builder: (context, constraints) {
          final heroHeight = math.max(200.0, constraints.maxHeight * 0.48);
          return SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: IntrinsicHeight(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    SizedBox(
                      height: heroHeight,
                      child: _Hero(isDark: isDark),
                    ),
                    Expanded(
                      child: SafeArea(
                        top: false,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(
                            RoseSpacing.gutterOnboarding,
                            RoseSpacing.s6,
                            RoseSpacing.gutterOnboarding,
                            RoseSpacing.buttonBottomInset,
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: <Widget>[
                              Text(
                                'Real connections between verified adults.',
                                style: theme.textTheme.headlineLarge?.copyWith(
                                  color: isDark ? scheme.onSurface : scheme.secondary,
                                ),
                              ),
                              const SizedBox(height: RoseSpacing.s4),
                              const _ValueProp(text: 'Every member is 18+ and identity-verified'),
                              const SizedBox(height: RoseSpacing.s2),
                              const _ValueProp(text: "You only chat when it's mutual"),
                              const Spacer(),
                              const SizedBox(height: RoseSpacing.s6),
                              FilledButton(
                                onPressed: () => context.push('/phone'),
                                child: const Text('Create account'),
                              ),
                              const SizedBox(height: RoseSpacing.s2),
                              TextButton(
                                onPressed: () => context.push('/phone'),
                                child: const Text('I already have an account'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero({required this.isDark});

  final bool isDark;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: isDark ? RoseColors.night800 : RoseColors.burgundy,
        borderRadius: const BorderRadius.vertical(bottom: Radius.circular(RoseRadius.lg)),
      ),
      child: SafeArea(
        bottom: false,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(
                Icons.circle,
                size: RoseSpacing.s3,
                color: RoseColors.champagneGold,
                semanticLabel: 'AMIVARA mark',
              ),
              const SizedBox(height: RoseSpacing.s2),
              Text('AMIVARA', style: RoseType.headlineLarge.copyWith(color: RoseColors.warmIvory, letterSpacing: 6)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ValueProp extends StatelessWidget {
  const _ValueProp({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Icon(Icons.verified_outlined, size: 20, color: theme.colorScheme.tertiary),
        const SizedBox(width: RoseSpacing.s2),
        Expanded(child: Text(text, style: theme.textTheme.bodyMedium)),
      ],
    );
  }
}
