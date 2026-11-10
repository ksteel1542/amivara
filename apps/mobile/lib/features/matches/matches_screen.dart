import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import '../discovery/profile_card.dart';
import 'matches_providers.dart';
import 'matches_repository.dart';

/// Matches list (Stage 4, sprint 5): newest conversation first, unread dots,
/// unmatch with confirmation. Tapping a match opens the chat (sprint 6).
class MatchesScreen extends ConsumerStatefulWidget {
  const MatchesScreen({super.key, this.avatarBuilder});

  /// Test hook: replaces network avatars.
  final Widget Function(MatchSummary match)? avatarBuilder;

  @override
  ConsumerState<MatchesScreen> createState() => _MatchesScreenState();
}

class _MatchesScreenState extends ConsumerState<MatchesScreen> {
  List<MatchSummary>? _matches;
  String? _error;
  StreamSubscription<String>? _push;

  String get _token => ref.read(sessionProvider)!.accessToken;

  @override
  void initState() {
    super.initState();
    _load();
    // "match.created" / "match.removed" / "message.new" pushes while the list is open: refresh.
    _push = ref.read(pushRegistrarProvider).events.listen((type) {
      if (type.startsWith('match.') || type == 'message.new') _load();
    });
  }

  @override
  void dispose() {
    _push?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final matches = await ref.read(matchesRepositoryProvider).list(_token);
      if (mounted) {
        setState(() {
          _matches = matches;
          _error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _confirmUnmatch(MatchSummary match) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        key: const Key('unmatch-dialog'),
        title: Text('Unmatch ${match.firstName}?', style: Theme.of(context).textTheme.headlineSmall),
        content: const Text(
          "You'll both lose this match and your conversation, and you won't see each other on AMIVARA again. "
          "This can't be undone.",
        ),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Unmatch'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    final previous = _matches;
    setState(() => _matches = _matches?.where((m) => m.matchId != match.matchId).toList());
    try {
      await ref.read(matchesRepositoryProvider).unmatch(_token, match.matchId);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.statusCode != 404) setState(() => _matches = previous); // 404 = already gone, which is fine
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _openChat(MatchSummary match) async {
    await context.push('/chat/${match.matchId}', extra: match);
    if (mounted) await _load(); // unread counts and last messages changed
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final matches = _matches;

    Widget body;
    if (matches == null && _error == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (matches == null) {
      body = Center(child: Text(_error!));
    } else if (matches.isEmpty) {
      body = Center(
        key: const Key('matches-empty'),
        child: Padding(
          padding: const EdgeInsets.all(RoseSpacing.s8),
          child: Text(
            'No matches yet. When someone you like likes you back, they appear here.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyLarge,
          ),
        ),
      );
    } else {
      body = RefreshIndicator(
        onRefresh: _load,
        child: ListView.separated(
          itemCount: matches.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, i) {
            final m = matches[i];
            final unread = m.unreadCount > 0;
            return ListTile(
              key: Key('match-${m.matchId}'),
              onTap: () => _openChat(m),
              leading: SizedBox(
                width: 52,
                height: 52,
                child: ClipOval(
                  child:
                      widget.avatarBuilder?.call(m) ??
                      (m.photoUrl != null
                          ? Image.network(
                              m.photoUrl!,
                              fit: BoxFit.cover,
                              errorBuilder: (_, _, _) => ColoredBox(color: theme.colorScheme.surfaceContainer),
                            )
                          : ColoredBox(color: theme.colorScheme.surfaceContainer)),
                ),
              ),
              title: Row(
                children: <Widget>[
                  Flexible(
                    child: Text(
                      '${m.firstName}, ${m.age}',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: unread ? FontWeight.w600 : FontWeight.w500,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (m.verified) ...<Widget>[const SizedBox(width: RoseSpacing.s1), const VerifiedBadge(size: 16)],
                  const SizedBox(width: RoseSpacing.s1),
                  Icon(
                    m.photosUnlocked ? Icons.lock_open_rounded : Icons.lock_outline_rounded,
                    key: Key('photos-${m.photosUnlocked ? 'unlocked' : 'locked'}-${m.matchId}'),
                    size: 14,
                    semanticLabel: m.photosUnlocked ? 'Photos unlocked' : 'Photos locked',
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ],
              ),
              subtitle: Text(
                m.lastMessage == null ? 'New match: say hello' : '${m.lastFromMe ? 'You: ' : ''}${m.lastMessage}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: unread ? theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurface) : null,
              ),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  if (unread)
                    Container(
                      key: Key('unread-${m.matchId}'),
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primary,
                        borderRadius: BorderRadius.circular(RoseRadius.full),
                      ),
                      child: Text(
                        '${m.unreadCount}',
                        style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onPrimary),
                      ),
                    ),
                  PopupMenuButton<String>(
                    key: Key('match-menu-${m.matchId}'),
                    tooltip: 'More',
                    onSelected: (_) => _confirmUnmatch(m),
                    itemBuilder: (_) => const <PopupMenuEntry<String>>[
                      PopupMenuItem<String>(value: 'unmatch', child: Text('Unmatch')),
                    ],
                  ),
                ],
              ),
            );
          },
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Matches')),
      body: body,
    );
  }
}
