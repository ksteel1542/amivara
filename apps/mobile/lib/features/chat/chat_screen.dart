import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import '../discovery/profile_card.dart';
import '../matches/matches_repository.dart';
import '../safety/report_user_sheet.dart';
import 'chat_providers.dart';
import 'chat_repository.dart';
import 'chat_socket.dart';

/// One conversation (Stage 4, sprint 6): live over /ws/chat with a REST
/// fallback, typing indicator, read ticks and the photo-unlock progress.
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.match});

  final MatchSummary match;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  static const Duration typingTimeout = Duration(seconds: 4);
  static const Duration typingThrottle = Duration(seconds: 3);

  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();
  late final ChatSocket _socket = ref.read(chatSocketFactoryProvider)();
  StreamSubscription<ChatEvent>? _events;

  /// Newest first (the list is reversed, so index 0 sits at the bottom).
  List<ChatMessage> _messages = <ChatMessage>[];
  PhotoUnlock? _photos;
  String? _nextBefore;
  bool _loading = true;
  bool _loadingOlder = false;
  bool _sending = false;
  String? _error;
  bool _theyAreTyping = false;
  Timer? _typingTimer;
  DateTime _lastTypingSent = DateTime.fromMillisecondsSinceEpoch(0);
  bool _gone = false;

  MatchSummary get _match => widget.match;
  String get _token => ref.read(sessionProvider)!.accessToken;
  ChatRepository get _repo => ref.read(chatRepositoryProvider);
  bool _fromThem(ChatMessage m) => m.senderId == _match.userId;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_maybeLoadOlder);
    _events = _socket.events.listen(_onEvent);
    unawaited(_socket.connect(_token));
    _loadFirstPage();
  }

  @override
  void dispose() {
    _typingTimer?.cancel();
    _events?.cancel();
    unawaited(_socket.close());
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  // ── Loading ───────────────────────────────────────────────

  Future<void> _loadFirstPage() async {
    try {
      final page = await _repo.history(_token, _match.matchId);
      if (!mounted) return;
      setState(() {
        _messages = _merge(page.messages, _messages);
        _nextBefore = page.nextBefore;
        _photos = page.photos;
        _loading = false;
      });
      _markRead();
    } on ApiException catch (e) {
      if (e.statusCode == 404) return _matchGone();
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.message;
        });
      }
    }
  }

  void _maybeLoadOlder() {
    if (!_scroll.hasClients || _loadingOlder || _nextBefore == null) return;
    // Reversed list: the oldest loaded message is at maxScrollExtent.
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 200) _loadOlder();
  }

  Future<void> _loadOlder() async {
    final before = _nextBefore;
    if (before == null) return;
    setState(() => _loadingOlder = true);
    try {
      final page = await _repo.history(_token, _match.matchId, before: before);
      if (!mounted) return;
      setState(() {
        _messages = _merge(_messages, page.messages);
        _nextBefore = page.nextBefore;
      });
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  /// Newest-first union, de-duplicated by id (socket echoes and REST replies can overlap).
  static List<ChatMessage> _merge(List<ChatMessage> a, List<ChatMessage> b) {
    final byId = <String, ChatMessage>{for (final m in b) m.id: m, for (final m in a) m.id: m};
    return byId.values.toList()..sort((x, y) {
      final c = y.createdAt.compareTo(x.createdAt);
      return c != 0 ? c : y.id.compareTo(x.id);
    });
  }

  // ── Live events ───────────────────────────────────────────

  void _onEvent(ChatEvent e) {
    if (!mounted || e.matchId != _match.matchId && e.event != 'error') return;
    switch (e.event) {
      case 'message.new':
        final message = ChatMessage.fromJson(e.data);
        setState(() {
          _messages = _merge(<ChatMessage>[message], _messages);
          if (_fromThem(message)) {
            _theyAreTyping = false;
            _typingTimer?.cancel();
          }
          _countTowardsUnlock(message);
        });
        if (_fromThem(message)) _markRead();
      case 'typing':
        if (e.data['user_id'] != _match.userId) return;
        _typingTimer?.cancel();
        _typingTimer = Timer(typingTimeout, () {
          if (mounted) setState(() => _theyAreTyping = false);
        });
        setState(() => _theyAreTyping = true);
      case 'message.read':
        _applyReadReceipt(e.data['up_to_message_id'] as String?, e.data['read_at'] as String?);
      case 'photos.unlocked':
        setState(() => _photos = (_photos ?? PhotoUnlock.open).copyWith(unlocked: true));
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Photos unlocked with ${_match.firstName} ✦')));
      case 'match.removed':
        _matchGone();
      case 'error':
        final message = e.data['message'] as String?;
        if (message != null) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  void _countTowardsUnlock(ChatMessage message) {
    final p = _photos;
    if (p == null || p.unlocked) return;
    _photos = _fromThem(message)
        ? p.copyWith(theirs: (p.theirs + 1).clamp(0, p.threshold))
        : p.copyWith(mine: (p.mine + 1).clamp(0, p.threshold));
  }

  void _applyReadReceipt(String? upToId, String? readAtIso) {
    if (upToId == null) return;
    final anchor = _messages.where((m) => m.id == upToId).firstOrNull;
    if (anchor == null) return;
    final at = DateTime.tryParse(readAtIso ?? '') ?? DateTime.now();
    setState(() {
      _messages = [
        for (final m in _messages)
          !_fromThem(m) && m.readAt == null && !m.createdAt.isAfter(anchor.createdAt) ? m.markRead(at) : m,
      ];
    });
  }

  /// Tells the server we've seen their newest message (ticks turn gold on their side).
  void _markRead() {
    final newest = _messages.where(_fromThem).firstOrNull;
    if (newest == null || newest.readAt != null) return;
    setState(() {
      _messages = [for (final m in _messages) _fromThem(m) && m.readAt == null ? m.markRead(DateTime.now()) : m];
    });
    final data = <String, dynamic>{'match_id': _match.matchId, 'up_to_message_id': newest.id};
    if (_socket.connected) {
      _socket.emit('message.read', data);
    } else {
      unawaited(_repo.markRead(_token, _match.matchId, newest.id).catchError((Object _) {}));
    }
  }

  /// Reporting or blocking ends the conversation (the server archives the match).
  Future<void> _openSafety() async {
    final theirs = _messages.where(_fromThem).firstOrNull;
    final outcome = await showSafetyMenu(
      context,
      userId: _match.userId,
      firstName: _match.firstName,
      messageId: theirs?.id,
    );
    if (outcome == null || !mounted) return;
    _gone = true; // the match.removed echo must not show "no longer available"
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/matches');
    }
  }

  void _matchGone() {
    if (_gone || !mounted) return;
    _gone = true;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('This match is no longer available.')));
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/matches');
    }
  }

  // ── Sending ───────────────────────────────────────────────

  void _onChanged(String text) {
    setState(() {}); // send button enabled state
    if (text.trim().isEmpty || !_socket.connected) return;
    final now = DateTime.now();
    if (now.difference(_lastTypingSent) < typingThrottle) return;
    _lastTypingSent = now;
    _socket.emit('typing', <String, dynamic>{'match_id': _match.matchId});
  }

  Future<void> _send() async {
    final body = _input.text.trim();
    if (body.isEmpty || _sending) return;
    _input.clear();
    setState(() {});
    if (_socket.connected) {
      // The server echoes it back as message.new, which adds the bubble.
      _socket.emit('message.send', <String, dynamic>{'match_id': _match.matchId, 'body': body});
      return;
    }
    setState(() => _sending = true);
    try {
      final message = await _repo.send(_token, _match.matchId, body);
      if (!mounted) return;
      setState(() {
        _messages = _merge(<ChatMessage>[message], _messages);
        _countTowardsUnlock(message);
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.statusCode == 404) return _matchGone();
      _input.text = body; // keep what they wrote
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  // ── UI ────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: <Widget>[
            Flexible(child: Text('${_match.firstName}, ${_match.age}', overflow: TextOverflow.ellipsis)),
            if (_match.verified) ...<Widget>[const SizedBox(width: RoseSpacing.s1), const VerifiedBadge(size: 16)],
          ],
        ),
        actions: <Widget>[
          IconButton(
            key: const Key('chat-safety-menu'),
            tooltip: 'Safety & Report',
            icon: const Icon(Icons.shield_outlined),
            onPressed: _openSafety,
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            if (_photos != null) PhotoUnlockBanner(photos: _photos!, theirName: _match.firstName),
            Expanded(child: _body(theme)),
            if (_theyAreTyping)
              Padding(
                key: const Key('typing-indicator'),
                padding: const EdgeInsets.fromLTRB(RoseSpacing.s4, 0, RoseSpacing.s4, RoseSpacing.s1),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    '${_match.firstName} is typing…',
                    style: theme.textTheme.bodySmall?.copyWith(fontStyle: FontStyle.italic),
                  ),
                ),
              ),
            _composer(theme),
          ],
        ),
      ),
    );
  }

  Widget _body(ThemeData theme) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null && _messages.isEmpty) return Center(child: Text(_error!));
    if (_messages.isEmpty) {
      return Center(
        key: const Key('chat-empty'),
        child: Padding(
          padding: const EdgeInsets.all(RoseSpacing.s8),
          child: Text(
            'You matched with ${_match.firstName}. Say hello!',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyLarge,
          ),
        ),
      );
    }
    return ListView.builder(
      key: const Key('chat-list'),
      controller: _scroll,
      reverse: true,
      padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s3, vertical: RoseSpacing.s2),
      itemCount: _messages.length + (_loadingOlder ? 1 : 0),
      itemBuilder: (context, i) {
        if (i == _messages.length) {
          return const Padding(
            key: Key('chat-loading-older'),
            padding: EdgeInsets.all(RoseSpacing.s3),
            child: Center(child: CircularProgressIndicator()),
          );
        }
        final m = _messages[i];
        return MessageBubble(message: m, mine: !_fromThem(m));
      },
    );
  }

  Widget _composer(ThemeData theme) {
    final canSend = _input.text.trim().isNotEmpty && !_sending;
    return Padding(
      padding: const EdgeInsets.fromLTRB(RoseSpacing.s3, RoseSpacing.s1, RoseSpacing.s2, RoseSpacing.s3),
      child: Row(
        children: <Widget>[
          Expanded(
            child: TextField(
              key: const Key('chat-input'),
              controller: _input,
              onChanged: _onChanged,
              onSubmitted: (_) => _send(),
              minLines: 1,
              maxLines: 5,
              maxLength: 2000,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(hintText: 'Message', counterText: ''),
            ),
          ),
          const SizedBox(width: RoseSpacing.s1),
          IconButton.filled(
            key: const Key('chat-send'),
            tooltip: 'Send',
            onPressed: canSend ? _send : null,
            icon: const Icon(Icons.send_rounded),
          ),
        ],
      ),
    );
  }
}

/// AMIVARA ROSE bubbles: mine in deep rose on the right, theirs on the surface tone on the left.
class MessageBubble extends StatelessWidget {
  const MessageBubble({super.key, required this.message, required this.mine});

  final ChatMessage message;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final fg = mine ? scheme.onPrimary : scheme.onSurface;
    const r = Radius.circular(RoseRadius.md);
    const tail = Radius.circular(RoseSpacing.s1);
    final local = message.createdAt.toLocal();
    final time = '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';

    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
        child: Container(
          key: Key('bubble-${message.id}'),
          margin: const EdgeInsets.symmetric(vertical: 3),
          padding: const EdgeInsets.fromLTRB(RoseSpacing.s3, RoseSpacing.s2, RoseSpacing.s3, 6),
          decoration: BoxDecoration(
            color: mine ? scheme.primary : scheme.surfaceContainer,
            borderRadius: BorderRadius.only(
              topLeft: r,
              topRight: r,
              bottomLeft: mine ? r : tail,
              bottomRight: mine ? tail : r,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Align(
                alignment: Alignment.centerLeft,
                widthFactor: 1,
                child: Text(message.body, style: theme.textTheme.bodyLarge?.copyWith(color: fg)),
              ),
              const SizedBox(height: 2),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(time, style: theme.textTheme.labelSmall?.copyWith(color: fg.withValues(alpha: 0.75))),
                  if (mine) ...<Widget>[
                    const SizedBox(width: 4),
                    message.readAt != null
                        ? Icon(
                            Icons.done_all_rounded,
                            key: Key('tick-read-${message.id}'),
                            size: 16,
                            semanticLabel: 'Read',
                            color: RoseColors.champagneGold,
                          )
                        : Icon(
                            Icons.done_rounded,
                            key: Key('tick-sent-${message.id}'),
                            size: 16,
                            semanticLabel: 'Sent',
                            color: fg.withValues(alpha: 0.75),
                          ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Progressive photo unlocking (PRD §5.5): both send 3 messages, then photos open in this chat.
class PhotoUnlockBanner extends StatelessWidget {
  const PhotoUnlockBanner({super.key, required this.photos, required this.theirName});

  final PhotoUnlock photos;
  final String theirName;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (photos.unlocked) {
      return Container(
        key: const Key('photos-unlocked'),
        width: double.infinity,
        color: theme.colorScheme.secondaryContainer,
        padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s4, vertical: RoseSpacing.s2),
        child: Row(
          children: <Widget>[
            Icon(Icons.lock_open_rounded, size: 18, color: theme.colorScheme.onSecondaryContainer),
            const SizedBox(width: RoseSpacing.s2),
            Expanded(
              child: Text(
                'Photos unlocked: you and $theirName can now share photos.',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSecondaryContainer),
              ),
            ),
          ],
        ),
      );
    }
    final total = photos.threshold * 2;
    return Container(
      key: const Key('photo-unlock-banner'),
      width: double.infinity,
      color: theme.colorScheme.surfaceContainer,
      padding: const EdgeInsets.fromLTRB(RoseSpacing.s4, RoseSpacing.s2, RoseSpacing.s4, RoseSpacing.s2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.lock_outline_rounded, size: 18, color: theme.colorScheme.primary),
              const SizedBox(width: RoseSpacing.s2),
              Expanded(
                child: Text(
                  'Photos unlock after you each send ${photos.threshold} messages · '
                  'You ${photos.mine}/${photos.threshold} · $theirName ${photos.theirs}/${photos.threshold}',
                  style: theme.textTheme.bodySmall,
                ),
              ),
            ],
          ),
          const SizedBox(height: RoseSpacing.s1),
          LinearProgressIndicator(value: (photos.mine + photos.theirs) / total),
        ],
      ),
    );
  }
}
