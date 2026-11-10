import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import 'discovery_models.dart';
import 'discovery_providers.dart';
import 'profile_card.dart';
import 'swipe_card_stack.dart';
import 'verify_prompt_modal.dart';

enum _FeedState { loading, needsLocation, ready, error }

/// The discovery card stack (Stage 4, sprint 4). Swipe left to pass, right to
/// like. Unverified members can browse and pass; liking opens the verify prompt.
class DiscoveryFeed extends ConsumerStatefulWidget {
  const DiscoveryFeed({super.key, required this.verified, this.imageBuilder = networkCardImage});

  /// From GET /me. Null while unknown: the API is then the judge (403 VERIFICATION_REQUIRED).
  final bool? verified;
  final CardImageBuilder imageBuilder;

  @override
  ConsumerState<DiscoveryFeed> createState() => _DiscoveryFeedState();
}

class _DiscoveryFeedState extends ConsumerState<DiscoveryFeed> {
  final _stack = GlobalKey<SwipeCardStackState>();
  final List<DiscoveryCard> _cards = <DiscoveryCard>[];
  String? _cursor;
  bool _exhausted = false;
  bool _fetching = false;
  _FeedState _state = _FeedState.loading;
  String? _error;

  String get _token => ref.read(sessionProvider)!.accessToken;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  Future<void> _load({bool reset = false}) async {
    if (_fetching || (!reset && _exhausted)) return;
    _fetching = true;
    if (reset) {
      setState(() {
        _state = _FeedState.loading;
        _cards.clear();
        _cursor = null;
        _exhausted = false;
      });
    }
    try {
      final page = await ref.read(discoveryRepositoryProvider).feed(_token, cursor: _cursor);
      if (!mounted) return;
      setState(() {
        final known = _cards.map((c) => c.userId).toSet();
        _cards.addAll(page.cards.where((c) => !known.contains(c.userId)));
        _cursor = page.nextCursor;
        _exhausted = page.nextCursor == null;
        _state = _FeedState.ready;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.code == 'LOCATION_REQUIRED') {
          _state = _FeedState.needsLocation;
        } else if (_cards.isEmpty) {
          _state = _FeedState.error;
          _error = e.message;
        }
      });
    } finally {
      _fetching = false;
    }
  }

  Future<void> _shareLocation() async {
    setState(() => _state = _FeedState.loading);
    final position = await ref.read(locationSourceProvider).currentPosition();
    if (!mounted) return;
    if (position == null) {
      setState(() => _state = _FeedState.needsLocation);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Turn on location for AMIVARA in your phone settings to see people near you.')),
      );
      return;
    }
    try {
      await ref.read(discoveryRepositoryProvider).updateLocation(_token, position.lat, position.lng);
      await _load(reset: true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _state = _FeedState.error;
        _error = e.message;
      });
    }
  }

  /// Gate for the stack: a right swipe from a known-unverified member opens the verify prompt instead.
  Future<bool> _canSwipe(SwipeDirection direction) async {
    if (direction == SwipeDirection.right && widget.verified == false) {
      await showVerifyPrompt(context);
      return false;
    }
    return true;
  }

  Future<void> _onSwiped(SwipeDirection direction) async {
    final card = _cards.removeAt(0);
    setState(() {});
    if (_cards.length <= 3) _load();

    final repo = ref.read(discoveryRepositoryProvider);
    try {
      if (direction == SwipeDirection.left) {
        await repo.pass(_token, card.userId);
      } else {
        final result = await repo.like(_token, card.userId);
        if (result.matched && mounted) await _showMatch(card);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'VERIFICATION_REQUIRED') {
        // The server is the judge: put the card back and explain.
        setState(() => _cards.insert(0, card));
        await showVerifyPrompt(context);
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _showMatch(DiscoveryCard card) {
    return showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const Key('match-dialog'),
        icon: const VerifiedBadge(size: 48),
        title: Text("It's a Match!", style: Theme.of(dialogContext).textTheme.headlineMedium),
        content: Text('You and ${card.firstName} like each other.', textAlign: TextAlign.center),
        actionsAlignment: MainAxisAlignment.center,
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Keep browsing')),
          FilledButton(
            onPressed: () {
              Navigator.pop(dialogContext);
              context.push('/matches');
            },
            child: const Text('View matches'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    switch (_state) {
      case _FeedState.loading:
        return const Center(child: CircularProgressIndicator());
      case _FeedState.needsLocation:
        return _Message(
          key: const Key('needs-location'),
          icon: Icons.place_outlined,
          title: 'See people near you',
          body:
              'AMIVARA uses your approximate location to show people nearby. Others only ever see a rounded '
              'distance, never where you are.',
          action: FilledButton(onPressed: _shareLocation, child: const Text('Share my location')),
        );
      case _FeedState.error:
        return _Message(
          icon: Icons.wifi_off_rounded,
          title: "Couldn't load profiles",
          body: _error ?? 'Please try again.',
          action: FilledButton(onPressed: () => _load(reset: true), child: const Text('Try again')),
        );
      case _FeedState.ready:
        if (_cards.isEmpty) {
          return _Message(
            key: const Key('feed-empty'),
            icon: Icons.auto_awesome_outlined,
            title: "You've seen everyone nearby",
            body: 'New people join every day. Check back soon, or widen your distance in settings.',
            action: OutlinedButton(onPressed: () => _load(reset: true), child: const Text('Refresh')),
          );
        }
    }

    return Column(
      children: <Widget>[
        Expanded(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(RoseSpacing.s3, RoseSpacing.s2, RoseSpacing.s3, 0),
            child: SwipeCardStack(
              key: _stack,
              itemCount: _cards.length,
              canSwipe: _canSwipe,
              onSwiped: _onSwiped,
              itemBuilder: (context, i) => ProfileCard(
                key: ValueKey<String>(_cards[i].userId),
                card: _cards[i],
                imageBuilder: widget.imageBuilder,
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: RoseSpacing.s4),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: <Widget>[
              _RoundButton(
                key: const Key('pass-button'),
                tooltip: 'Pass',
                icon: Icons.close_rounded,
                color: theme.colorScheme.onSurfaceVariant,
                onPressed: () => _stack.currentState?.swipe(SwipeDirection.left),
              ),
              _RoundButton(
                key: const Key('like-button'),
                tooltip: 'Like',
                icon: Icons.favorite_rounded,
                color: theme.colorScheme.primary,
                large: true,
                onPressed: () => _stack.currentState?.swipe(SwipeDirection.right),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({
    super.key,
    required this.tooltip,
    required this.icon,
    required this.color,
    required this.onPressed,
    this.large = false,
  });

  final String tooltip;
  final IconData icon;
  final Color color;
  final VoidCallback onPressed;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final size = large ? 72.0 : 60.0;
    return Tooltip(
      message: tooltip,
      child: Material(
        shape: const CircleBorder(),
        color: Theme.of(context).colorScheme.surfaceContainer,
        elevation: 2,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: SizedBox(
            width: size,
            height: size,
            child: Icon(icon, color: color, size: size * 0.45),
          ),
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({super.key, required this.icon, required this.title, required this.body, required this.action});

  final IconData icon;
  final String title;
  final String body;
  final Widget action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(RoseSpacing.s8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 48, color: theme.colorScheme.primary),
            const SizedBox(height: RoseSpacing.s4),
            Text(title, textAlign: TextAlign.center, style: theme.textTheme.headlineSmall),
            const SizedBox(height: RoseSpacing.s2),
            Text(body, textAlign: TextAlign.center, style: theme.textTheme.bodyLarge),
            const SizedBox(height: RoseSpacing.s6),
            action,
          ],
        ),
      ),
    );
  }
}
