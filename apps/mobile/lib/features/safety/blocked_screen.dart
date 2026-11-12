import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import 'safety_repository.dart';

/// People you've blocked (GET /safety/blocks), with unblock. Unblocking only lets
/// you see each other in discovery again: a match that ended never comes back.
class BlockedScreen extends ConsumerStatefulWidget {
  const BlockedScreen({super.key});

  @override
  ConsumerState<BlockedScreen> createState() => _BlockedScreenState();
}

class _BlockedScreenState extends ConsumerState<BlockedScreen> {
  List<BlockedMember>? _blocked;
  String? _error;

  String get _token => ref.read(sessionProvider)!.accessToken;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final list = await ref.read(safetyRepositoryProvider).blocks(_token);
      if (mounted) setState(() => (_blocked = list, _error = null));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _unblock(BlockedMember b) async {
    final name = b.firstName ?? 'this member';
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        key: const Key('unblock-dialog'),
        title: Text('Unblock $name?'),
        content: const Text(
          "You may see each other in discovery again. If you were matched, that match won't come back.",
        ),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(
            key: const Key('unblock-confirm'),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Unblock'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await ref.read(safetyRepositoryProvider).unblock(_token, b.userId);
    } on ApiException catch (e) {
      if (e.statusCode != 404) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
        return;
      }
    }
    if (!mounted) return;
    setState(() => _blocked = _blocked?.where((x) => x.userId != b.userId).toList());
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$name is unblocked.')));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final blocked = _blocked;
    Widget body;
    if (blocked == null) {
      body = Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!));
    } else if (blocked.isEmpty) {
      body = Center(
        key: const Key('blocked-empty'),
        child: Padding(
          padding: const EdgeInsets.all(RoseSpacing.s8),
          child: Text("You haven't blocked anyone.", style: theme.textTheme.bodyLarge, textAlign: TextAlign.center),
        ),
      );
    } else {
      body = ListView.separated(
        itemCount: blocked.length,
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (context, i) {
          final b = blocked[i];
          final d = b.blockedAt.toLocal();
          return ListTile(
            key: Key('blocked-${b.userId}'),
            leading: const Icon(Icons.block_rounded),
            title: Text(b.firstName ?? 'Member'),
            subtitle: Text('Blocked ${d.day}/${d.month}/${d.year}'),
            trailing: TextButton(
              key: Key('unblock-${b.userId}'),
              onPressed: () => _unblock(b),
              child: const Text('Unblock'),
            ),
          );
        },
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Blocked members')),
      body: body,
    );
  }
}
