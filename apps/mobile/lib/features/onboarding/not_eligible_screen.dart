import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';

/// Screen 3x: not eligible (under 18). Kind, not punitive. No back button and
/// no "edit date": the phone and device are blocked for 12 months server-side.
class NotEligibleScreen extends ConsumerStatefulWidget {
  const NotEligibleScreen({super.key});

  @override
  ConsumerState<NotEligibleScreen> createState() => _NotEligibleScreenState();
}

class _NotEligibleScreenState extends ConsumerState<NotEligibleScreen> {
  @override
  void initState() {
    super.initState();
    // Forget the in-progress signup (signup token, date of birth) on this device.
    WidgetsBinding.instance.addPostFrameCallback((_) => ref.read(signupFlowProvider.notifier).reset());
  }

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
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                const Spacer(),
                Icon(Icons.auto_awesome_outlined, size: 56, color: theme.colorScheme.secondary),
                const SizedBox(height: RoseSpacing.s6),
                Text(
                  'AMIVARA is for adults only',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.headlineMedium?.copyWith(
                    color: theme.brightness == Brightness.dark
                        ? theme.colorScheme.onSurface
                        : theme.colorScheme.secondary,
                  ),
                ),
                const SizedBox(height: RoseSpacing.s4),
                Text(
                  "You need to be 18 or older to use AMIVARA. We've closed this signup and haven't saved your details.",
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyLarge,
                ),
                const Spacer(),
                FilledButton(
                  key: const Key('not-eligible-close'),
                  onPressed: () => SystemNavigator.pop(),
                  child: const Text('Close'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
