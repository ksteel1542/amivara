import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import 'settings_repository.dart';

/// Settings & Privacy (Stage 4, sprint 8): pause and incognito, signed-in
/// devices, "Download my data" (NDPA access right) and account deletion.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  AccountSettings? _settings;
  List<DeviceSession>? _sessions;
  String? _error;
  bool _saving = false;
  bool _exporting = false;

  String get _token => ref.read(sessionProvider)!.accessToken;
  SettingsRepository get _repo => ref.read(settingsRepositoryProvider);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait<Object>(<Future<Object>>[_repo.settings(_token), _repo.sessions(_token)]);
      if (!mounted) return;
      setState(() {
        _settings = results[0] as AccountSettings;
        _sessions = results[1] as List<DeviceSession>;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _toast(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _update({bool? paused, bool? incognito}) async {
    setState(() => _saving = true);
    try {
      final next = await _repo.update(_token, paused: paused, incognito: incognito);
      if (!mounted) return;
      setState(() => _settings = next);
      if (paused != null) {
        _toast(paused ? "You're paused: hidden from discovery. Your matches can still chat." : "You're visible again.");
      }
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _revoke(DeviceSession session) async {
    try {
      await _repo.revokeSession(_token, session.id);
    } on ApiException catch (e) {
      if (e.statusCode != 404) {
        if (mounted) _toast(e.message);
        return;
      }
    }
    if (!mounted) return;
    setState(() => _sessions = _sessions?.where((s) => s.id != session.id).toList());
    _toast('${session.label} signed out.');
  }

  Future<void> _revokeOthers() async {
    try {
      final count = await _repo.revokeOtherSessions(_token);
      if (!mounted) return;
      setState(() => _sessions = _sessions?.where((s) => s.current).toList());
      _toast(count == 1 ? 'Signed out 1 other device.' : 'Signed out $count other devices.');
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    }
  }

  Future<void> _export() async {
    setState(() => _exporting = true);
    try {
      final json = await _repo.exportData(_token);
      final day = DateTime.now().toIso8601String().substring(0, 10);
      await ref.read(dataSaverProvider).save('amivara-data-$day.json', json);
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(context: context, builder: (_) => const DeleteAccountDialog());
    if (confirmed != true || !mounted) return;
    final DateTime purgeAfter;
    try {
      purgeAfter = await _repo.deleteAccount(_token);
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
      return;
    }
    await ref.read(sessionProvider.notifier).signOut();
    if (!mounted) return;
    final d = purgeAfter.toLocal();
    final messenger = ScaffoldMessenger.of(context);
    context.go('/');
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          'Your account is deleted. It will be erased on ${d.day}/${d.month}/${d.year}. '
          'Sign in before then to keep it.',
        ),
      ),
    );
  }

  Future<void> _signOut() async {
    await ref.read(sessionProvider.notifier).signOut();
    if (mounted) context.go('/');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final settings = _settings;
    final sessions = _sessions;

    if (settings == null || sessions == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Settings & Privacy')),
        body: Center(
          child: _error == null
              ? const CircularProgressIndicator()
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(_error!),
                    const SizedBox(height: RoseSpacing.s3),
                    OutlinedButton(onPressed: _load, child: const Text('Try again')),
                  ],
                ),
        ),
      );
    }

    final others = sessions.where((s) => !s.current).length;
    return Scaffold(
      appBar: AppBar(title: const Text('Settings & Privacy')),
      body: ListView(
        key: const Key('settings-list'),
        children: <Widget>[
          _Header('Visibility'),
          SwitchListTile(
            key: const Key('pause-switch'),
            title: const Text('Pause my account'),
            subtitle: const Text("Hide me from discovery. My matches and chats carry on."),
            value: settings.paused,
            onChanged: _saving ? null : (v) => _update(paused: v),
          ),
          SwitchListTile(
            key: const Key('incognito-switch'),
            title: const Text('Incognito'),
            subtitle: const Text("Only people I've liked can see me."),
            value: settings.incognito,
            onChanged: _saving ? null : (v) => _update(incognito: v),
          ),
          ListTile(
            key: const Key('preferences-tile'),
            leading: const Icon(Icons.tune_rounded),
            title: const Text('Discovery preferences'),
            subtitle: const Text('Who you see, age range, distance, interests and languages'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/preferences'),
          ),
          ListTile(
            key: const Key('blocked-tile'),
            leading: const Icon(Icons.block_rounded),
            title: const Text('Blocked members'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/blocked'),
          ),
          const Divider(),
          _Header('Signed-in devices'),
          for (final s in sessions)
            ListTile(
              key: Key('session-${s.id}'),
              leading: Icon(s.platform == 'web' ? Icons.laptop_outlined : Icons.phone_android_outlined),
              title: Text(s.label),
              subtitle: Text(s.current ? 'This device' : 'Last active ${_ago(s.lastUsedAt)}'),
              trailing: s.current
                  ? null
                  : TextButton(key: Key('revoke-${s.id}'), onPressed: () => _revoke(s), child: const Text('Sign out')),
            ),
          if (others > 1)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s4),
              child: Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton(
                  key: const Key('revoke-others'),
                  onPressed: _revokeOthers,
                  child: const Text('Sign out all other devices'),
                ),
              ),
            ),
          const Divider(),
          _Header('Your data'),
          ListTile(
            key: const Key('export-button'),
            leading: _exporting
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.download_outlined),
            title: const Text('Download my data'),
            subtitle: const Text('Your profile, matches, messages you sent and verification history, as a JSON file.'),
            onTap: _exporting ? null : _export,
          ),
          ListTile(
            key: const Key('sign-out'),
            leading: const Icon(Icons.logout),
            title: const Text('Sign out'),
            onTap: _signOut,
          ),
          ListTile(
            key: const Key('delete-account'),
            leading: Icon(Icons.delete_forever_outlined, color: theme.colorScheme.error),
            title: Text('Delete account', style: TextStyle(color: theme.colorScheme.error)),
            subtitle: const Text('Erased for good after 30 days.'),
            onTap: _delete,
          ),
          const SizedBox(height: RoseSpacing.s8),
        ],
      ),
    );
  }

  static String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 60) return 'just now';
    if (d.inHours < 24) return '${d.inHours} h ago';
    if (d.inDays < 30) return '${d.inDays} days ago';
    return '${t.day}/${t.month}/${t.year}';
  }
}

class _Header extends StatelessWidget {
  const _Header(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(RoseSpacing.s4, RoseSpacing.s4, RoseSpacing.s4, RoseSpacing.s1),
    child: Text(
      text,
      style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Theme.of(context).colorScheme.primary),
    ),
  );
}

/// Deleting needs the member to type DELETE: no accidental taps.
class DeleteAccountDialog extends StatefulWidget {
  const DeleteAccountDialog({super.key});

  @override
  State<DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<DeleteAccountDialog> {
  final TextEditingController _confirm = TextEditingController();

  @override
  void dispose() {
    _confirm.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ready = _confirm.text.trim().toUpperCase() == 'DELETE';
    return AlertDialog(
      key: const Key('delete-dialog'),
      title: const Text('Delete your account?'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text(
              "You'll be signed out on every device, and you'll disappear from discovery straight away. "
              'Your matches and chats end, and they can\'t be brought back.\n\n'
              'Everything is erased for good after 30 days. Signing in before then restores your account.',
            ),
            const SizedBox(height: RoseSpacing.s3),
            TextField(
              key: const Key('delete-confirm-field'),
              controller: _confirm,
              onChanged: (_) => setState(() {}),
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(labelText: 'Type DELETE to confirm'),
            ),
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        FilledButton(
          key: const Key('delete-confirm'),
          style: FilledButton.styleFrom(backgroundColor: theme.colorScheme.error),
          onPressed: ready ? () => Navigator.pop(context, true) : null,
          child: const Text('Delete account'),
        ),
      ],
    );
  }
}
