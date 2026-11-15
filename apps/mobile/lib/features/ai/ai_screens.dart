import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import '../wallet/topup_sheet.dart';
import '../wallet/wallet_repository.dart' show formatThousands;
import 'ai_repository.dart';

/// The "AI Companion" label, shown on every AI surface (MONETIZATION_PLAN.md 3e). Never the gold badge.
class AiBadge extends StatelessWidget {
  const AiBadge({super.key, this.label = 'AI Companion'});

  final String label;

  @override
  Widget build(BuildContext context) => Semantics(
    label: label,
    child: Container(
      key: const Key('ai-badge'),
      padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s2, vertical: 2),
      decoration: BoxDecoration(color: RoseColors.night800, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Icon(Icons.smart_toy_outlined, size: 12, color: RoseColors.ivory50),
          const SizedBox(width: 4),
          Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: RoseColors.ivory50)),
        ],
      ),
    ),
  );
}

/// Illustrated avatar: never a photo of a real-looking person.
class AiAvatar extends StatelessWidget {
  const AiAvatar({super.key, required this.name, this.size = 52});

  final String name;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: const BoxDecoration(
      shape: BoxShape.circle,
      gradient: LinearGradient(colors: <Color>[RoseColors.night800, RoseColors.rose700]),
    ),
    alignment: Alignment.center,
    child: Icon(Icons.smart_toy_rounded, color: RoseColors.ivory50, size: size * 0.5),
  );
}

/// GET /ai/companions: their own section, away from real members.
class AiCompanionsScreen extends ConsumerStatefulWidget {
  const AiCompanionsScreen({super.key});

  @override
  ConsumerState<AiCompanionsScreen> createState() => _AiCompanionsScreenState();
}

class _AiCompanionsScreenState extends ConsumerState<AiCompanionsScreen> {
  List<AiCompanion>? _companions;
  bool _available = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final r = await ref.read(aiRepositoryProvider).companions(ref.read(sessionProvider)!.accessToken);
      if (mounted) {
        setState(() {
          _companions = r.companions;
          _available = r.available;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final list = _companions;
    return Scaffold(
      appBar: AppBar(title: const Text('AI Companions')),
      body: list == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!))
          : ListView(
              key: const Key('ai-companions'),
              padding: const EdgeInsets.all(RoseSpacing.s4),
              children: <Widget>[
                Container(
                  key: const Key('ai-disclosure'),
                  padding: const EdgeInsets.all(RoseSpacing.s3),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Text(
                    'AI Companions are artificial intelligence, not real people. They only reply when you '
                    'message them. A few messages a day are free; after that each message costs coins. '
                    'You can set a daily limit or take a break in Settings.',
                  ),
                ),
                if (!_available) ...<Widget>[
                  const SizedBox(height: RoseSpacing.s3),
                  const Text(
                    'AI Companions are resting right now. Please check back later.',
                    key: Key('ai-unavailable'),
                  ),
                ],
                const SizedBox(height: RoseSpacing.s3),
                for (final c in list)
                  Card(
                    child: ListTile(
                      key: Key('ai-companion-${c.slug}'),
                      leading: AiAvatar(name: c.name),
                      title: Row(
                        children: <Widget>[
                          Flexible(child: Text(c.name, overflow: TextOverflow.ellipsis)),
                          const SizedBox(width: RoseSpacing.s2),
                          AiBadge(label: c.label),
                        ],
                      ),
                      subtitle: Text(c.tagline),
                      enabled: _available,
                      onTap: () => context.push('/ai/chat/${c.slug}'),
                    ),
                  ),
              ],
            ),
    );
  }
}

/// A chat with one AI Companion. Labelled throughout; the companion never writes first.
class AiChatScreen extends ConsumerStatefulWidget {
  const AiChatScreen({super.key, required this.slug});

  final String slug;

  @override
  ConsumerState<AiChatScreen> createState() => _AiChatScreenState();
}

class _AiChatScreenState extends ConsumerState<AiChatScreen> {
  final TextEditingController _input = TextEditingController();
  AiConversation? _conversation;
  List<AiMessage> _messages = <AiMessage>[];
  AiBilling? _billing;
  String? _error;
  String? _notice;
  bool _sending = false;

  String get _token => ref.read(sessionProvider)!.accessToken;
  AiRepository get _repo => ref.read(aiRepositoryProvider);

  @override
  void initState() {
    super.initState();
    unawaited(_open());
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _open() async {
    try {
      final c = await _repo.open(_token, widget.slug);
      if (!mounted) return;
      setState(() {
        _conversation = c;
        _messages = c.messages;
        _billing = c.billing;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _send() async {
    final c = _conversation;
    final body = _input.text.trim();
    if (c == null || body.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _notice = null;
    });
    try {
      final r = await _repo.send(_token, c.id, body);
      if (!mounted) return;
      _input.clear();
      setState(() {
        _messages = <AiMessage>[r.reply, r.message, ..._messages];
        _billing = r.billing;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      switch (e.code) {
        case 'INSUFFICIENT_COINS':
          final balance = (e.details['balance'] as num?)?.toInt();
          final required = (e.details['required'] as num?)?.toInt();
          unawaited(showTopUpSheet(context, needed: balance == null || required == null ? null : required - balance));
        case 'SPEND_LIMIT_REACHED':
        case 'SELF_EXCLUDED':
        case 'AI_UNAVAILABLE':
          setState(() => _notice = e.message);
        default:
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _report(AiMessage m) async {
    try {
      await _repo.report(_token, m.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Thanks. Our team will review it.')));
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _delete() async {
    final c = _conversation;
    if (c == null) return;
    try {
      await _repo.delete(_token, c.id);
      if (mounted) context.pop();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = _conversation;
    final billing = _billing;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: <Widget>[
            Flexible(child: Text(c?.companion.name ?? 'AI Companion', overflow: TextOverflow.ellipsis)),
            const SizedBox(width: RoseSpacing.s2),
            const AiBadge(),
          ],
        ),
        actions: <Widget>[
          PopupMenuButton<String>(
            key: const Key('ai-chat-menu'),
            onSelected: (v) => v == 'delete' ? _delete() : null,
            itemBuilder: (_) => const <PopupMenuEntry<String>>[
              PopupMenuItem<String>(value: 'delete', child: Text('Delete this chat')),
            ],
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Container(
              key: const Key('ai-chat-disclosure'),
              width: double.infinity,
              color: theme.colorScheme.surfaceContainerHighest,
              padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s4, vertical: RoseSpacing.s2),
              child: Text(
                "You're chatting with an AI, not a real person. Long-press a reply to report it.",
                style: theme.textTheme.bodySmall,
              ),
            ),
            Expanded(
              child: c == null
                  ? Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!))
                  : ListView.builder(
                      key: const Key('ai-chat-list'),
                      reverse: true,
                      padding: const EdgeInsets.all(RoseSpacing.s3),
                      itemCount: _messages.length,
                      itemBuilder: (_, i) => _AiBubble(message: _messages[i], onReport: _report),
                    ),
            ),
            if (_notice != null)
              Padding(
                key: const Key('ai-notice'),
                padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s4, vertical: RoseSpacing.s1),
                child: Text(_notice!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
              ),
            if (billing != null)
              Padding(
                key: const Key('ai-billing'),
                padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s4),
                child: Text(
                  billing.freeRemainingToday > 0
                      ? '${billing.freeRemainingToday} free messages left today, then ${billing.priceCoins} coins each.'
                      : 'Messages cost ${billing.priceCoins} coins each (${billing.freePerDay} free again tomorrow).',
                  style: theme.textTheme.bodySmall,
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(RoseSpacing.s3, RoseSpacing.s1, RoseSpacing.s2, RoseSpacing.s3),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: TextField(
                      key: const Key('ai-chat-input'),
                      controller: _input,
                      minLines: 1,
                      maxLines: 4,
                      maxLength: 1000,
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(hintText: 'Message', counterText: ''),
                    ),
                  ),
                  IconButton.filled(
                    key: const Key('ai-chat-send'),
                    onPressed: _input.text.trim().isEmpty || _sending || c == null ? null : _send,
                    icon: _sending
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.send_rounded),
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

class _AiBubble extends StatelessWidget {
  const _AiBubble({required this.message, required this.onReport});

  final AiMessage message;
  final void Function(AiMessage) onReport;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final ai = message.fromCompanion;
    return Align(
      alignment: ai ? Alignment.centerLeft : Alignment.centerRight,
      child: GestureDetector(
        onLongPress: ai ? () => onReport(message) : null,
        child: Container(
          key: Key('ai-bubble-${message.id}'),
          margin: const EdgeInsets.symmetric(vertical: 3),
          padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s3, vertical: RoseSpacing.s2),
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
          decoration: BoxDecoration(
            color: ai ? scheme.surfaceContainer : scheme.primary,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (ai) Text('AI', style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700)),
              Text(message.body, style: TextStyle(color: ai ? scheme.onSurface : scheme.onPrimary)),
              if (message.refunded)
                Text('Not delivered: coins refunded', style: Theme.of(context).textTheme.labelSmall),
            ],
          ),
        ),
      ),
    );
  }
}

/// Settings → Spending limits: a daily cap for AI Companion chats, and a break (7 or 30 days).
class SpendLimitsScreen extends ConsumerStatefulWidget {
  const SpendLimitsScreen({super.key});

  @override
  ConsumerState<SpendLimitsScreen> createState() => _SpendLimitsScreenState();
}

class _SpendLimitsScreenState extends ConsumerState<SpendLimitsScreen> {
  static const List<int?> caps = <int?>[null, 50, 100, 200, 500];
  SpendLimits? _limits;
  bool _busy = false;

  String get _token => ref.read(sessionProvider)!.accessToken;
  AiRepository get _repo => ref.read(aiRepositoryProvider);

  @override
  void initState() {
    super.initState();
    unawaited(_run(() => _repo.limits(_token)));
  }

  Future<void> _run(Future<SpendLimits> Function() action) async {
    setState(() => _busy = true);
    try {
      final l = await action();
      if (mounted) setState(() => _limits = l);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirmBreak(int days) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        key: const Key('self-exclude-dialog'),
        title: Text('Take a $days-day break?'),
        content: const Text(
          "You won't be able to chat with AI Companions until it ends. A break can be made longer, but not shorter.",
        ),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          FilledButton(
            key: const Key('self-exclude-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Start break'),
          ),
        ],
      ),
    );
    if (ok == true) await _run(() => _repo.selfExclude(_token, days));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l = _limits;
    return Scaffold(
      appBar: AppBar(title: const Text('Spending limits')),
      body: l == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              key: const Key('spend-limits'),
              padding: const EdgeInsets.all(RoseSpacing.s4),
              children: <Widget>[
                Text('Daily limit for AI Companion chats', style: theme.textTheme.titleMedium),
                const SizedBox(height: RoseSpacing.s1),
                Text(
                  'Spent today: ${formatThousands(l.spentToday)} coins'
                  '${l.effectiveCap != null ? ' of ${formatThousands(l.effectiveCap!)}' : ''}.',
                  key: const Key('spend-today'),
                ),
                const SizedBox(height: RoseSpacing.s2),
                Wrap(
                  spacing: RoseSpacing.s2,
                  children: <Widget>[
                    for (final cap in caps)
                      ChoiceChip(
                        key: Key('cap-${cap ?? 'none'}'),
                        label: Text(cap == null ? 'No limit' : '${formatThousands(cap)} coins'),
                        selected: l.aiDailyCapCoins == cap,
                        onSelected: _busy ? null : (_) => _run(() => _repo.setCap(_token, cap)),
                      ),
                  ],
                ),
                const Divider(height: RoseSpacing.s8),
                Text('Take a break', style: theme.textTheme.titleMedium),
                const SizedBox(height: RoseSpacing.s1),
                if (l.selfExcludedUntil != null)
                  Text(
                    'On a break from AI Companions until ${MaterialLocalizations.of(context).formatMediumDate(l.selfExcludedUntil!.toLocal())}.',
                    key: const Key('self-excluded'),
                  )
                else
                  const Text('Pause AI Companion chats completely for a while.'),
                const SizedBox(height: RoseSpacing.s2),
                Row(
                  children: <Widget>[
                    OutlinedButton(
                      key: const Key('break-7'),
                      onPressed: _busy ? null : () => _confirmBreak(7),
                      child: const Text('7 days'),
                    ),
                    const SizedBox(width: RoseSpacing.s2),
                    OutlinedButton(
                      key: const Key('break-30'),
                      onPressed: _busy ? null : () => _confirmBreak(30),
                      child: const Text('30 days'),
                    ),
                  ],
                ),
              ],
            ),
    );
  }
}
