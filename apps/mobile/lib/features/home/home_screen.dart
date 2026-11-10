import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import '../auth/auth_repository.dart';
import '../discovery/discovery_feed.dart';
import '../discovery/profile_card.dart';

final currentMemberProvider = FutureProvider.autoDispose<MemberSummary?>((ref) async {
  final session = ref.watch(sessionProvider);
  if (session == null) return null;
  return ref.read(authRepositoryProvider).me(session.accessToken);
});

/// Card images: the network in the app, a placeholder in widget tests.
final cardImageBuilderProvider = Provider<CardImageBuilder>((ref) => networkCardImage);

/// Home = discovery (Stage 4, sprint 4). Unverified members browse and pass;
/// the banner and the like gate lead to Smile ID verification (PRD §5.3a).
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final me = ref.watch(currentMemberProvider);
    final verified = me.value?.ageVerified;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text('AMIVARA', style: theme.textTheme.titleLarge?.copyWith(letterSpacing: 4)),
            if (verified == true) ...<Widget>[
              const SizedBox(width: RoseSpacing.s2),
              const VerifiedBadge(key: Key('verified-badge'), size: 20),
            ],
          ],
        ),
        actions: <Widget>[
          IconButton(
            key: const Key('edit-profile'),
            tooltip: 'Edit profile',
            icon: const Icon(Icons.person_outline),
            onPressed: () => context.push('/profile/edit'),
          ),
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
      body: Column(
        children: <Widget>[
          if (verified == false)
            Material(
              key: const Key('verify-banner'),
              color: theme.colorScheme.surfaceContainer,
              child: InkWell(
                onTap: () => context.push('/verify-intro'),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s4, vertical: RoseSpacing.s3),
                  child: Row(
                    children: <Widget>[
                      Icon(Icons.verified_outlined, color: theme.colorScheme.tertiary, size: 20),
                      const SizedBox(width: RoseSpacing.s3),
                      const Expanded(child: Text('Verify to start liking and chatting')),
                      const Icon(Icons.chevron_right),
                    ],
                  ),
                ),
              ),
            ),
          Expanded(
            child: DiscoveryFeed(verified: verified, imageBuilder: ref.watch(cardImageBuilderProvider)),
          ),
        ],
      ),
    );
  }
}
