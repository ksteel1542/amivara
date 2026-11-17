import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import '../calls/call_repository.dart';
import '../matches/matches_repository.dart';

/// A person card in the online-Hosts strip and the newcomers panel.
class PersonCard {
  const PersonCard({
    required this.userId,
    required this.firstName,
    required this.age,
    this.city,
    this.photoUrl,
    this.invitedToday = false,
  });

  factory PersonCard.fromJson(Map<String, dynamic> json) => PersonCard(
    userId: json['user_id'] as String,
    firstName: json['first_name'] as String? ?? '',
    age: (json['age'] as num?)?.toInt() ?? 0,
    city: json['city'] as String?,
    photoUrl: json['photo_url'] as String?,
    invitedToday: json['invited_today'] as bool? ?? false,
  );

  final String userId;
  final String firstName;
  final int age;
  final String? city;
  final String? photoUrl;
  final bool invitedToday;
}

abstract interface class HostConnectRepository {
  /// Verified Hosts with the app open right now.
  Future<List<PersonCard>> onlineHosts(String accessToken);

  /// Opens (or reopens) the chat with a Host, no mutual like needed. Returns the match id.
  Future<String> openChat(String accessToken, String hostId);

  /// Active Hosts: newcomers online now who accept live call invites.
  Future<List<PersonCard>> newcomers(String accessToken);

  /// Active Hosts: rings a newcomer (Quick Connect).
  Future<CallInfo> invite(String accessToken, String userId, CallType type);

  /// "Receive live call invites" (Settings).
  Future<bool> setCallInvites(String accessToken, bool enabled);
}

class HttpHostConnectRepository implements HostConnectRepository {
  const HttpHostConnectRepository(this._api);

  final ApiClient _api;

  List<PersonCard> _cards(Map<String, dynamic> json, String key) =>
      (json[key] as List<dynamic>).cast<Map<String, dynamic>>().map(PersonCard.fromJson).toList();

  @override
  Future<List<PersonCard>> onlineHosts(String accessToken) async =>
      _cards(await _api.get('/hosts/online', bearer: accessToken), 'hosts');

  @override
  Future<String> openChat(String accessToken, String hostId) async =>
      (await _api.post('/hosts/$hostId/chat', bearer: accessToken))['match_id'] as String;

  @override
  Future<List<PersonCard>> newcomers(String accessToken) async =>
      _cards(await _api.get('/hosts/newcomers', bearer: accessToken), 'newcomers');

  @override
  Future<CallInfo> invite(String accessToken, String userId, CallType type) async => CallInfo.fromJson(
    (await _api.post(
          '/hosts/newcomers/$userId/call',
          bearer: accessToken,
          body: <String, dynamic>{'type': type.name},
        ))['call']
        as Map<String, dynamic>,
  );

  @override
  Future<bool> setCallInvites(String accessToken, bool enabled) async =>
      (await _api.put(
            '/me/call-invites',
            bearer: accessToken,
            body: <String, dynamic>{'enabled': enabled},
          ))['call_invites_enabled']
          as bool;
}

/// Overridden in main.dart and in tests.
final hostConnectRepositoryProvider = Provider<HostConnectRepository>(
  (ref) => throw UnimplementedError('override in main'),
);

class _Avatar extends StatelessWidget {
  const _Avatar({required this.person, this.radius = 30, this.online = false});

  final PersonCard person;
  final double radius;
  final bool online;

  @override
  Widget build(BuildContext context) {
    final url = person.photoUrl;
    return Stack(
      clipBehavior: Clip.none,
      children: <Widget>[
        CircleAvatar(
          radius: radius,
          backgroundColor: RoseColors.rose100,
          foregroundImage: url == null ? null : NetworkImage(url),
          child: Text(
            person.firstName.isEmpty ? '?' : person.firstName.characters.first.toUpperCase(),
            style: TextStyle(fontSize: radius * 0.7, color: RoseColors.burgundy),
          ),
        ),
        if (online)
          Positioned(
            right: 0,
            bottom: 2,
            child: Container(
              width: radius * 0.42,
              height: radius * 0.42,
              decoration: BoxDecoration(
                color: const Color(0xFF2E9E5B),
                shape: BoxShape.circle,
                border: Border.all(color: Theme.of(context).colorScheme.surface, width: 2),
              ),
            ),
          ),
      ],
    );
  }
}

/// Home: Verified Hosts online now. One tap opens a chat, no mutual like needed.
class OnlineHostsStrip extends ConsumerStatefulWidget {
  const OnlineHostsStrip({super.key});

  @override
  ConsumerState<OnlineHostsStrip> createState() => _OnlineHostsStripState();
}

class _OnlineHostsStripState extends ConsumerState<OnlineHostsStrip> {
  List<PersonCard> _hosts = const <PersonCard>[];
  bool _opening = false;

  String get _token => ref.read(sessionProvider)!.accessToken;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final hosts = await ref.read(hostConnectRepositoryProvider).onlineHosts(_token);
      if (mounted) setState(() => _hosts = hosts);
    } on Object {
      // The strip is optional: discovery works without it.
    }
  }

  Future<void> _open(PersonCard host) async {
    if (_opening) return;
    _opening = true;
    try {
      final matchId = await ref.read(hostConnectRepositoryProvider).openChat(_token, host.userId);
      if (!mounted) return;
      await context.push(
        '/chat/$matchId',
        extra: MatchSummary(
          matchId: matchId,
          userId: host.userId,
          firstName: host.firstName,
          age: host.age,
          verified: true,
          unreadCount: 0,
          photoUrl: host.photoUrl,
        ),
      );
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      _opening = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_hosts.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return Column(
      key: const Key('online-hosts'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(RoseSpacing.s4, RoseSpacing.s2, RoseSpacing.s4, 0),
          child: Text('Verified Hosts online · chat now', style: theme.textTheme.titleSmall),
        ),
        SizedBox(
          height: 104,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s4, vertical: RoseSpacing.s2),
            itemCount: _hosts.length,
            separatorBuilder: (_, _) => const SizedBox(width: RoseSpacing.s3),
            itemBuilder: (_, i) {
              final h = _hosts[i];
              return InkWell(
                key: Key('online-host-${h.userId}'),
                borderRadius: BorderRadius.circular(12),
                onTap: () => _open(h),
                child: SizedBox(
                  width: 68,
                  child: Column(
                    children: <Widget>[
                      _Avatar(person: h, online: true),
                      const SizedBox(height: 4),
                      Text(
                        h.firstName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.labelMedium,
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

/// Host dashboard: Quick Connect. Online newcomers who accept live call invites;
/// the Host rings them (they pay after their free preview, and see the price first).
class NewcomersPanel extends ConsumerStatefulWidget {
  const NewcomersPanel({super.key});

  @override
  ConsumerState<NewcomersPanel> createState() => _NewcomersPanelState();
}

class _NewcomersPanelState extends ConsumerState<NewcomersPanel> {
  List<PersonCard>? _newcomers;
  final Set<String> _invited = <String>{};

  String get _token => ref.read(sessionProvider)!.accessToken;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final list = await ref.read(hostConnectRepositoryProvider).newcomers(_token);
      if (mounted) setState(() => _newcomers = list);
    } on Object {
      if (mounted) setState(() => _newcomers = const <PersonCard>[]);
    }
  }

  Future<void> _invite(PersonCard person, CallType type) async {
    try {
      await ref.read(hostConnectRepositoryProvider).invite(_token, person.userId, type);
      if (!mounted) return;
      setState(() => _invited.add(person.userId));
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Ringing ${person.firstName}…')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final list = _newcomers;
    return Card(
      key: const Key('newcomers-panel'),
      child: Padding(
        padding: const EdgeInsets.all(RoseSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(child: Text('Online newcomers · Quick Connect', style: theme.textTheme.titleMedium)),
                IconButton(
                  key: const Key('newcomers-refresh'),
                  tooltip: 'Refresh',
                  onPressed: _load,
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
            Text(
              'New members online now who accept live call invites. They pay after a free preview, '
              'and see the price before they answer. Be warm and respectful.',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: RoseSpacing.s2),
            if (list == null)
              const Center(child: CircularProgressIndicator())
            else if (list.isEmpty)
              Text(
                'No newcomers online right now.',
                key: const Key('newcomers-empty'),
                style: theme.textTheme.bodyMedium,
              )
            else
              for (final n in list)
                ListTile(
                  key: Key('newcomer-${n.userId}'),
                  contentPadding: EdgeInsets.zero,
                  leading: _Avatar(person: n, radius: 22, online: true),
                  title: Text('${n.firstName}, ${n.age}'),
                  subtitle: n.city == null ? null : Text(n.city!),
                  trailing: n.invitedToday || _invited.contains(n.userId)
                      ? const Text('Invited')
                      : Row(
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[
                            IconButton(
                              key: Key('newcomer-voice-${n.userId}'),
                              tooltip: 'Voice call invite',
                              icon: const Icon(Icons.call_outlined),
                              onPressed: () => _invite(n, CallType.voice),
                            ),
                            IconButton(
                              key: Key('newcomer-video-${n.userId}'),
                              tooltip: 'Video call invite',
                              icon: const Icon(Icons.videocam_outlined),
                              onPressed: () => _invite(n, CallType.video),
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
