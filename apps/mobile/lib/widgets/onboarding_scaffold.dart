import 'package:flutter/material.dart';

import '../theme/rose_tokens.g.dart';

/// Shared layout for onboarding steps 2–5 (UI_WIREFRAMES global rules):
/// progress bar, Playfair title, scrolling body and a pill CTA pinned to the bottom.
class OnboardingScaffold extends StatelessWidget {
  const OnboardingScaffold({
    super.key,
    required this.step,
    required this.title,
    required this.children,
    required this.primaryLabel,
    required this.onPrimary,
    this.subtitle,
    this.primaryBusy = false,
    this.secondary,
    this.showBack = true,
    this.totalSteps = 5,
  });

  final int step;
  final int totalSteps;
  final String title;
  final String? subtitle;
  final List<Widget> children;
  final String primaryLabel;
  final VoidCallback? onPrimary;
  final bool primaryBusy;
  final Widget? secondary;
  final bool showBack;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: showBack,
        backgroundColor: theme.colorScheme.surface,
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(4),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.gutterOnboarding),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(RoseRadius.full),
              child: LinearProgressIndicator(
                value: step / totalSteps,
                minHeight: 4,
                backgroundColor: theme.colorScheme.surfaceContainer,
                semanticsLabel: 'Step $step of $totalSteps',
              ),
            ),
          ),
        ),
      ),
      body: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  RoseSpacing.gutterOnboarding,
                  RoseSpacing.s6,
                  RoseSpacing.gutterOnboarding,
                  RoseSpacing.s6,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text(title, style: theme.textTheme.headlineLarge?.copyWith(color: _titleColor(theme))),
                    if (subtitle != null) ...<Widget>[
                      const SizedBox(height: RoseSpacing.s2),
                      Text(
                        subtitle!,
                        style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                    const SizedBox(height: RoseSpacing.s6),
                    ...children,
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
                  FilledButton(
                    onPressed: primaryBusy ? null : onPrimary,
                    child: primaryBusy
                        ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                        : Text(primaryLabel),
                  ),
                  if (secondary != null) ...<Widget>[const SizedBox(height: RoseSpacing.s2), secondary!],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static Color _titleColor(ThemeData theme) =>
      theme.brightness == Brightness.dark ? theme.colorScheme.onSurface : theme.colorScheme.secondary;
}

/// Inline error card (error container colours, readable in both themes).
class ErrorBanner extends StatelessWidget {
  const ErrorBanner({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(RoseSpacing.s3),
        decoration: BoxDecoration(
          color: scheme.error.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(RoseRadius.sm),
          border: Border.all(color: scheme.error.withValues(alpha: 0.4)),
        ),
        child: Row(
          children: <Widget>[
            Icon(Icons.error_outline, color: scheme.error, size: 20),
            const SizedBox(width: RoseSpacing.s2),
            Expanded(
              child: Text(message, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: scheme.error)),
            ),
          ],
        ),
      ),
    );
  }
}
