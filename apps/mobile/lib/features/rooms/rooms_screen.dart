import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import '../calls/call_repository.dart';
import 'rooms_repository.dart';

/// Chat House (M6/7): live rooms to listen in on, and "Go live" for Verified Hosts.
class RoomsScreen extends ConsumerStatefulWidget {
  const RoomsScreen({super.key});

  @override
  ConsumerState<RoomsScreen> createState() => _RoomsScreenState();
}

class _RoomsScreenState extends ConsumerState<RoomsScreen> {
  List<RoomSummary>? _rooms;
  String? _error;

  String get _token => ref.read(sessionProvider)!.accessToken;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final rooms = await ref.read(roomsRepositoryProvider).list(_token);
      if (mounted) setState(() => (_rooms = rooms, _error = null));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _open(RoomSummary room) async {
    await context.push('/room/${room.id}');
    if (mounted) unawaited(_load());
  }

  Future<void> _goLive() async {
    final joined = await showModalBottomSheet<({Room room, CallMedia media})>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      builder: (_) => const GoLiveSheet(),
    );
    if (joined == null || !mounted) return;
    await context.push('/room/${joined.room.id}', extra: joined);
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rooms = _rooms;
    return Scaffold(
      appBar: AppBar(title: const Text('Chat House')),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('rooms-go-live'),
        onPressed: _goLive,
        icon: const Icon(Icons.podcasts),
        label: const Text('Go live'),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _error != null
            ? ListView(
                children: <Widget>[Padding(padding: const EdgeInsets.all(24), child: Text(_error!))],
              )
            : rooms == null
            ? const Center(child: CircularProgressIndicator())
            : rooms.isEmpty
            ? ListView(
                children: <Widget>[
                  const SizedBox(height: 96),
                  Icon(Icons.podcasts, size: 56, color: theme.colorScheme.primary),
                  const SizedBox(height: RoseSpacing.s3),
                  Text(
                    'No live rooms right now',
                    key: const Key('rooms-empty'),
                    style: theme.textTheme.titleMedium,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: RoseSpacing.s1),
                  Text(
                    'Follow Hosts to hear when they go live.',
                    style: theme.textTheme.bodyMedium,
                    textAlign: TextAlign.center,
                  ),
                ],
              )
            : ListView.separated(
                padding: const EdgeInsets.fromLTRB(RoseSpacing.s4, RoseSpacing.s3, RoseSpacing.s4, 96),
                itemCount: rooms.length,
                separatorBuilder: (_, _) => const SizedBox(height: RoseSpacing.s2),
                itemBuilder: (_, i) => _RoomCard(room: rooms[i], onTap: () => _open(rooms[i])),
              ),
      ),
    );
  }
}

class _RoomCard extends StatelessWidget {
  const _RoomCard({required this.room, required this.onTap});

  final RoomSummary room;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      key: Key('room-${room.id}'),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(RoseSpacing.s3),
          child: Row(
            children: <Widget>[
              CircleAvatar(
                radius: 26,
                backgroundColor: RoseColors.burgundy,
                child: Icon(room.video ? Icons.videocam : Icons.graphic_eq, color: RoseColors.warmIvory),
              ),
              const SizedBox(width: RoseSpacing.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        const _LiveChip(),
                        if (room.followersOnly) ...<Widget>[
                          const SizedBox(width: 6),
                          Icon(Icons.lock_outline, size: 14, color: theme.colorScheme.onSurfaceVariant),
                        ],
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(room.title, style: theme.textTheme.titleMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
                    Text('${room.hostName}${room.following ? ' · Following' : ''}', style: theme.textTheme.bodySmall),
                  ],
                ),
              ),
              Column(
                children: <Widget>[
                  const Icon(Icons.headphones, size: 18),
                  Text('${room.listeners}', style: theme.textTheme.labelMedium),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LiveChip extends StatelessWidget {
  const _LiveChip();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(color: const Color(0xFFD64545), borderRadius: BorderRadius.circular(999)),
    child: const Text(
      'LIVE',
      style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1),
    ),
  );
}

/// "Go live": title, audio or video, open or followers-only.
class GoLiveSheet extends ConsumerStatefulWidget {
  const GoLiveSheet({super.key});

  @override
  ConsumerState<GoLiveSheet> createState() => _GoLiveSheetState();
}

class _GoLiveSheetState extends ConsumerState<GoLiveSheet> {
  final TextEditingController _title = TextEditingController();
  bool _video = false;
  bool _followersOnly = false;
  bool _starting = false;
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    final title = _title.text.trim();
    if (title.isEmpty) {
      setState(() => _error = 'Give your room a title.');
      return;
    }
    setState(() => (_starting = true, _error = null));
    try {
      final joined = await ref
          .read(roomsRepositoryProvider)
          .open(ref.read(sessionProvider)!.accessToken, title: title, video: _video, followersOnly: _followersOnly);
      if (mounted) Navigator.of(context).pop((room: joined.room, media: joined.media));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _starting = false;
        _error = e.code == 'HOST_ONLY' ? 'Only Verified Hosts can go live. Turn on Host mode in Settings.' : e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      key: const Key('go-live-sheet'),
      padding: EdgeInsets.fromLTRB(
        RoseSpacing.s4,
        0,
        RoseSpacing.s4,
        RoseSpacing.s4 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text('Start a Chat House', style: theme.textTheme.titleLarge),
          const SizedBox(height: RoseSpacing.s3),
          TextField(
            key: const Key('go-live-title'),
            controller: _title,
            maxLength: 80,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Room title', hintText: 'e.g. Friday night vibes'),
          ),
          const SizedBox(height: RoseSpacing.s2),
          SegmentedButton<bool>(
            key: const Key('go-live-mode'),
            segments: const <ButtonSegment<bool>>[
              ButtonSegment<bool>(value: false, icon: Icon(Icons.graphic_eq), label: Text('Audio')),
              ButtonSegment<bool>(value: true, icon: Icon(Icons.videocam_outlined), label: Text('Video')),
            ],
            selected: <bool>{_video},
            onSelectionChanged: (s) => setState(() => _video = s.first),
          ),
          const SizedBox(height: RoseSpacing.s2),
          SegmentedButton<bool>(
            key: const Key('go-live-audience'),
            segments: const <ButtonSegment<bool>>[
              ButtonSegment<bool>(value: false, icon: Icon(Icons.public), label: Text('Open')),
              ButtonSegment<bool>(value: true, icon: Icon(Icons.lock_outline), label: Text('Followers')),
            ],
            selected: <bool>{_followersOnly},
            onSelectionChanged: (s) => setState(() => _followersOnly = s.first),
          ),
          const SizedBox(height: RoseSpacing.s2),
          Text(
            'Rooms are live only and never recorded. Up to 8 verified guests can join you on stage.',
            style: theme.textTheme.bodySmall,
          ),
          if (_error != null) ...<Widget>[
            const SizedBox(height: RoseSpacing.s2),
            Text(
              _error!,
              key: const Key('go-live-error'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ],
          const SizedBox(height: RoseSpacing.s3),
          FilledButton.icon(
            key: const Key('go-live-start'),
            onPressed: _starting ? null : _start,
            icon: const Icon(Icons.podcasts),
            label: const Text('Go live'),
          ),
        ],
      ),
    );
  }
}
