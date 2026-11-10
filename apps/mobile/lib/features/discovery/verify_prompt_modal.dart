import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../theme/rose_tokens.g.dart';

/// Shown when a browse-only (unverified) member tries to like (PRD §5.3a).
/// "Verify now" opens the Smile ID explainer; nothing is liked.
Future<void> showVerifyPrompt(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    // Size to the content (and scroll if needed) rather than the default 9/16 cap,
    // so large text sizes never clip the buttons.
    isScrollControlled: true,
    builder: (sheetContext) {
      final theme = Theme.of(sheetContext);
      return SafeArea(
        child: SingleChildScrollView(
          key: const Key('verify-prompt'),
          padding: const EdgeInsets.fromLTRB(RoseSpacing.s6, 0, RoseSpacing.s6, RoseSpacing.s6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Center(
                child: Container(
                  width: 64,
                  height: 64,
                  decoration: const BoxDecoration(color: RoseColors.champagneGold, shape: BoxShape.circle),
                  child: const Icon(Icons.check_rounded, size: 40, color: RoseColors.burgundyBlack),
                ),
              ),
              const SizedBox(height: RoseSpacing.s4),
              Text('Verify to start liking', textAlign: TextAlign.center, style: theme.textTheme.headlineSmall),
              const SizedBox(height: RoseSpacing.s2),
              Text(
                'Everyone you can like on AMIVARA is a verified adult. Take 2 minutes to verify, '
                "then like and chat freely. You'll get the gold badge too.",
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyLarge,
              ),
              const SizedBox(height: RoseSpacing.s6),
              FilledButton(
                onPressed: () {
                  Navigator.pop(sheetContext);
                  context.push('/verify-intro');
                },
                child: const Text('Verify now'),
              ),
              TextButton(onPressed: () => Navigator.pop(sheetContext), child: const Text('Not now')),
            ],
          ),
        ),
      );
    },
  );
}
