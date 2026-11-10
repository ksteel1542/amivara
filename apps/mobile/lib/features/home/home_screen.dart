import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import '../auth/auth_repository.dart';

final _meProvider = FutureProvider.autoDispose<MemberSummary?>((ref) async {
  final session = ref.watch(sessionProvider);
  if (session == null) return null;
  return ref.read(authRepositoryProvider).me(session.accessToken);
});

/// Placeholder home for sprint 1: confirms sign-in and shows the browse-only
/// banner (PRD §5.3a). Discovery arrives in sprint 4, Smile ID in sprint 3.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final me = ref.watch(_meProvider);
    final name = me.value?.firstName;
    final verified = me.value?.ageVerified ?? false;

    return Scaffold(
      appBar: AppBar(
        title: Text('AMIVARA', style: theme.textTheme.titleLarge?.copyWith(letterSpacing: 4)),
        actions: <Widget>[
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () async {
              await ref.read(sessionProvider.notifier).signOut();
              if (context.mounted) context.go('/');
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(RoseSpacing.gutterOnboarding),
        children: <Widget>[
          if (!verified)
            Card(
              key: const Key('verify-banner'),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => context.push('/verify-intro'),
                child: Padding(
                  padding: const EdgeInsets.all(RoseSpacing.s4),
                  child: Row(
                    children: <Widget>[
                      Icon(Icons.verified_outlined, color: theme.colorScheme.tertiary),
                      const SizedBox(width: RoseSpacing.s3),
                      const Expanded(child: Text('Verify to start liking and chatting')),
                      const Icon(Icons.chevron_right),
                    ],
                  ),
                ),
              ),
            ),
          const SizedBox(height: RoseSpacing.s8),
          Text(
            name == null ? 'Welcome' : "You're in, $name",
            style: theme.textTheme.headlineLarge?.copyWith(
              color: theme.brightness == Brightness.dark ? theme.colorScheme.onSurface : theme.colorScheme.secondary,
            ),
          ),
          const SizedBox(height: RoseSpacing.s2),
          Text(
            'Discovery is coming soon. Make your profile shine in the meantime.',
            style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: RoseSpacing.s6),
          OutlinedButton.icon(
            key: const Key('edit-profile'),
            onPressed: () => context.push('/profile/edit'),
            icon: const Icon(Icons.edit_outlined),
            label: const Text('Edit profile'),
          ),
        ],
      ),
    );
  }
}
