import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../theme/rose_tokens.g.dart';

/// Screen 1: Welcome & warm brand introduction (docs/UI_WIREFRAMES.md).
///
/// The hero is the Rose Route couple photo with a burgundy scrim, the gold mark
/// and the ivory wordmark on top.
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

class _Hero extends StatelessWidget {
  const _Hero({required this.isDark});

  final bool isDark;

  /// The couple photo (Rose Route brand board, centre panel; see design/hero.png).
  static const String photo = 'assets/images/welcome_hero.jpg';

  @override
  Widget build(BuildContext context) {
    // The scrim fades into the canvas below: burgundy in light mode, night in dark mode.
    final base = isDark ? RoseColors.night950 : RoseColors.burgundy;
    return ClipRRect(
      borderRadius: const BorderRadius.vertical(bottom: Radius.circular(RoseRadius.lg)),
      child: ColoredBox(
        color: base,
        child: Stack(
          fit: StackFit.expand,
          children: <Widget>[
            // Faces sit in the upper half of the portrait: keep them in frame on any screen shape.
            Image.asset(
              photo,
              key: const Key('welcome-hero-photo'),
              fit: BoxFit.cover,
              alignment: const Alignment(0, -0.35),
              excludeFromSemantics: true,
              frameBuilder: (context, child, frame, sync) => sync
                  ? child
                  : AnimatedOpacity(
                      opacity: frame == null ? 0 : 1,
                      duration: RoseMotion.long,
                      curve: Curves.easeOut,
                      child: child,
                    ),
            ),
            // Burgundy scrim over the bottom 40% so the wordmark reads on any photo.
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  stops: const <double>[0, 0.6, 1],
                  colors: <Color>[
                    base.withValues(alpha: 0),
                    base.withValues(alpha: 0.35),
                    base.withValues(alpha: 0.92),
                  ],
                ),
              ),
            ),
            Positioned(
              left: RoseSpacing.s4,
              right: RoseSpacing.s4,
              bottom: RoseSpacing.s6,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  const Icon(
                    Icons.auto_awesome,
                    size: RoseSpacing.s4,
                    color: RoseColors.champagneGold,
                    semanticLabel: 'AMIVARA mark',
                  ),
                  const SizedBox(height: RoseSpacing.s1),
                  Text(
                    'AMIVARA',
                    style: RoseType.headlineLarge.copyWith(
                      color: RoseColors.warmIvory,
                      letterSpacing: 6,
                      shadows: const <Shadow>[Shadow(blurRadius: 12, color: Color(0x66000000))],
                    ),
                  ),
                ],
              ),
            ),
          ],
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
