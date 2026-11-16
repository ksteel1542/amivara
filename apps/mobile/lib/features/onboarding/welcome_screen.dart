import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../theme/rose_tokens.g.dart';
import 'welcome_animation.dart';

/// Screen 1: Welcome & warm brand introduction (docs/UI_WIREFRAMES.md).
///
/// The hero is a full-motion, looping intro (WelcomeAnimation): two love birds
/// fly together and become a glowing heart over a shifting rose-gold and
/// burgundy sky, with love lines floating through.
///
/// The hero takes ~52% of the screen (so both CTAs clear the gesture bar on a 360 x 800dp phone). Below it the content fills the remaining
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
          final heroHeight = math.max(240.0, constraints.maxHeight * 0.52);
          return SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: IntrinsicHeight(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    SizedBox(
                      height: heroHeight,
                      child: const ClipRRect(
                        borderRadius: BorderRadius.vertical(bottom: Radius.circular(RoseRadius.lg)),
                        child: WelcomeAnimation(),
                      ),
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
                                'Real connections between real adults.',
                                style: theme.textTheme.headlineLarge?.copyWith(
                                  color: isDark ? scheme.onSurface : scheme.secondary,
                                ),
                              ),
                              const SizedBox(height: RoseSpacing.s4),
                              const _ValueProp(text: '18+ only. Verified members wear a gold badge'),
                              const SizedBox(height: RoseSpacing.s2),
                              const _ValueProp(text: "You only chat when it's mutual"),
                              const Spacer(),
                              const SizedBox(height: RoseSpacing.s6),
                              FilledButton(
                                onPressed: () => context.push('/email'),
                                child: const Text('Create account'),
                              ),
                              const SizedBox(height: RoseSpacing.s2),
                              TextButton(
                                onPressed: () => context.push('/email'),
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
