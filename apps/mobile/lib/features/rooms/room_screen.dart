import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import '../calls/call_engine.dart';
import '../calls/call_repository.dart';
import '../chat/chat_providers.dart';
import '../chat/chat_socket.dart';
import '../gifts/gift_drawer.dart';
import '../gifts/gift_repository.dart';
import '../safety/safety_repository.dart';
import 'rooms_repository.dart';

/// A live Chat House room (M6/7): the stage (Host and up to 8 guests), the
/// audience count, live room chat, gifts, seat requests, follow and report.
/// Hosts also get seat requests and per-speaker controls.
class RoomScreen extends ConsumerStatefulWidget {
  const RoomScreen({super.key, required this.roomId, this.opened});

  final String roomId;

  /// Set when the Host just went live (the room and their join token).
  final ({Room room, CallMedia media})? opened;

  @override
  ConsumerState<RoomScreen> createState() => _RoomScreenState();
}

class _RoomScreenState extends ConsumerState<RoomScreen> {
  late final ChatSocket _socket = ref.read(chatSocketFactoryProvider)();
  StreamSubscription<ChatEvent>? _events;
  CallEngine? _engine;
  final TextEditingController _input = TextEditingController();

  Room? _room;
  String? _error;
  List<RoomMessage> _messages = <RoomMessage>[];
  bool _micOn = true;
  bool _leaving = false;
  bool _closed = false;

  // Read once: dispose() still needs them to leave the room.
  late final String _token = ref.read(sessionProvider)!.accessToken;
  late final RoomsRepository _repo = ref.read(roomsRepositoryProvider);

  @override
  void initState() {
    super.initState();
    _token;
    _repo;
    _events = _socket.events.listen(_onEvent);
    unawaited(_socket.connect(_token));
    unawaited(_enter());
  }

  @override
  void dispose() {
    unawaited(_events?.cancel());
    unawaited(_socket.close());
    unawaited(_engine?.disconnect());
    if (!_leaving && !_closed && _room != null) {
      // Back gesture or app navigation: leave quietly (the Host's room ends).
      unawaited(_repo.leave(_token, widget.roomId).catchError((Object _) {}));
    }
    _input.dispose();
    super.dispose();
  }

  Future<void> _enter() async {
    try {
      final joined = widget.opened ?? await _repo.join(_token, widget.roomId);
      if (!mounted) return;
      setState(() => _room = joined.room);
      unawaited(_loadMessages());
      final engine = ref.read(callEngineFactoryProvider)();
      _engine = engine;
      await engine.connect(
        url: joined.media.url,
        token: joined.media.token,
        video: joined.room.video,
        publish: joined.room.canSpeak,
      );
      if (mounted) setState(() {});
    } on ApiException catch (e) {
      if (mounted) {
        setState(
          () => _error = switch (e.code) {
            'FOLLOWERS_ONLY' => 'This room is for followers. Follow the Host to join.',
            'ROOM_ENDED' => 'This room has ended.',
            _ => e.message,
          },
        );
      }
    } on Object {
      if (mounted) setState(() => _error = "Couldn't connect to the room. Please try again.");
    }
  }

  Future<void> _loadMessages() async {
    try {
      final messages = await _repo.messages(_token, widget.roomId);
      if (mounted) setState(() => _messages = messages.reversed.toList());
    } on Object {
      // The chat fills from live events.
    }
  }

  void _onEvent(ChatEvent e) {
    if (!mounted || (e.data['room_id'] ?? (e.data['room'] as Map<String, dynamic>?)?['id']) != widget.roomId) return;
    switch (e.event) {
      case 'room:updated':
        final next = Room.fromJson(e.data['room'] as Map<String, dynamic>);
        final could = _room?.canSpeak ?? false;
        setState(() => _room = next);
        if (next.canSpeak != could) {
          unawaited(_engine?.setPublishing(next.canSpeak, video: next.video));
          setState(() => _micOn = next.canSpeak);
          if (next.canSpeak && next.myRole == RoomRole.speaker) _snack("You're on stage. Say hello!");
        }
      case 'room:message':
        final message = RoomMessage.fromJson(e.data['message'] as Map<String, dynamic>);
        if (_messages.any((m) => m.id == message.id)) return;
        setState(() => _messages = <RoomMessage>[..._messages, message]);
      case 'room:gift':
        final gift = e.data['gift'] as Map<String, dynamic>;
        final from = (e.data['from'] as Map<String, dynamic>)['first_name'] as String? ?? '';
        final to = (e.data['to'] as Map<String, dynamic>)['first_name'] as String? ?? '';
        // My own gift already got its banner when I sent it.
        if ((e.data['from'] as Map<String, dynamic>)['id'] == _room?.myId) return;
        showGiftToast(
          context,
          gift: Gift(
            id: '',
            slug: gift['slug'] as String,
            name: gift['name'] as String,
            emoji: gift['emoji'] as String,
            priceCoins: 0,
          ),
          toName: to,
          text: '$from sent $to a ${gift['name']}',
        );
      case 'room:seat_request':
        final user = e.data['user'] as Map<String, dynamic>;
        _snack('${user['first_name']} asked to speak');
      case 'room:ended':
        _close(e.data['reason'] == 'host_ended' ? 'The Host ended the room.' : 'This room has ended.');
      case 'room:removed':
        _close('You were removed from this room.');
    }
  }

  void _close(String message) {
    if (_closed) return;
    _closed = true;
    unawaited(_engine?.disconnect());
    _engine = null;
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..removeCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
    if (context.canPop()) context.pop();
  }

  void _snack(String text) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _run(Future<void> Function() action) async {
    try {
      await action();
    } on ApiException catch (e) {
      _snack(e.message);
    }
  }

  Future<void> _leave() async {
    final room = _room;
    if (room != null && room.isHost) {
      final end = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          key: const Key('room-end-dialog'),
          title: const Text('End this room?'),
          content: const Text('Everyone will be disconnected.'),
          actions: <Widget>[
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Stay')),
            FilledButton(
              key: const Key('room-end-confirm'),
              onPressed: () => Navigator.pop(context, true),
              child: const Text('End room'),
            ),
          ],
        ),
      );
      if (end != true) return;
      _leaving = true;
      await _run(() => _repo.end(_token, widget.roomId));
    } else {
      _leaving = true;
      await _run(() => _repo.leave(_token, widget.roomId));
    }
    unawaited(_engine?.disconnect());
    _engine = null;
    if (mounted && context.canPop()) context.pop();
  }

  Future<void> _send() async {
    final body = _input.text.trim();
    if (body.isEmpty) return;
    try {
      final message = await _repo.send(_token, widget.roomId, body);
      _input.clear();
      if (mounted && !_messages.any((m) => m.id == message.id)) {
        setState(() => _messages = <RoomMessage>[..._messages, message]);
      }
    } on ApiException catch (e) {
      _snack(e.message);
    }
  }

  Future<void> _gift({RoomSpeaker? to}) async {
    final room = _room;
    if (room == null) return;
    await sendGiftFlow(
      context,
      ref,
      toName: to?.firstName ?? room.hostName,
      send: (gift, key) => ref
          .read(giftRepositoryProvider)
          .sendInRoom(_token, widget.roomId, gift.id, key, recipientId: to?.isHost ?? true ? null : to!.id),
    );
  }

  Future<void> _toggleFollow() async {
    final room = _room;
    if (room == null) return;
    await _run(() async {
      await _repo.follow(_token, room.hostId, !room.following);
      final following = !room.following;
      if (mounted) {
        setState(() => _room = Room.fromJson(<String, dynamic>{..._roomJson(room), 'me': _meJson(room, following)}));
      }
    });
  }

  Future<void> _report() async {
    final category = await showModalBottomSheet<ReportCategory>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          key: const Key('room-report-sheet'),
          shrinkWrap: true,
          children: <Widget>[
            const ListTile(title: Text('Report this room')),
            for (final c in ReportCategory.values)
              ListTile(
                key: Key('room-report-${c.apiValue}'),
                title: Text(c.label),
                subtitle: Text(c.hint),
                onTap: () => Navigator.pop(context, c),
              ),
          ],
        ),
      ),
    );
    if (category == null) return;
    await _run(() async {
      await _repo.report(_token, widget.roomId, category: category.apiValue);
      _leaving = true;
      _close('Thanks. Our Safety team will review this room.');
    });
  }

  /// The Host's controls for one guest on stage.
  Future<void> _manage(RoomSpeaker speaker) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            ListTile(title: Text(speaker.firstName)),
            ListTile(
              key: const Key('speaker-mute'),
              leading: Icon(speaker.mutedByHost ? Icons.mic : Icons.mic_off),
              title: Text(speaker.mutedByHost ? 'Unmute' : 'Mute'),
              onTap: () => Navigator.pop(context, speaker.mutedByHost ? 'unmute' : 'mute'),
            ),
            ListTile(
              key: const Key('speaker-unseat'),
              leading: const Icon(Icons.event_seat_outlined),
              title: const Text('Move to audience'),
              onTap: () => Navigator.pop(context, 'unseat'),
            ),
            ListTile(
              key: const Key('speaker-ban'),
              leading: const Icon(Icons.block),
              title: const Text('Remove from room'),
              onTap: () => Navigator.pop(context, 'ban'),
            ),
          ],
        ),
      ),
    );
    switch (action) {
      case 'mute' || 'unmute':
        await _run(() => _repo.setMuted(_token, widget.roomId, speaker.id, action == 'mute'));
      case 'unseat':
        await _run(() => _repo.unseat(_token, widget.roomId, speaker.id));
      case 'ban':
        await _run(() => _repo.ban(_token, widget.roomId, speaker.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final room = _room;
    final theme = Theme.of(context);
    if (room == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Chat House')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: _error == null
                ? const CircularProgressIndicator()
                : Text(_error!, key: const Key('room-error'), textAlign: TextAlign.center),
          ),
        ),
      );
    }
    final engine = _engine;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_leave());
      },
      child: Scaffold(
        key: const Key('room-screen'),
        appBar: AppBar(
          titleSpacing: 0,
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(room.title, overflow: TextOverflow.ellipsis),
              Text(
                '${room.hostName} · ${room.listeners} listening',
                key: const Key('room-listeners'),
                style: theme.textTheme.bodySmall,
              ),
            ],
          ),
          actions: <Widget>[
            if (!room.isHost)
              TextButton(
                key: const Key('room-follow'),
                onPressed: _toggleFollow,
                child: Text(room.following ? 'Following' : 'Follow'),
              ),
            if (!room.isHost)
              IconButton(
                key: const Key('room-report'),
                tooltip: 'Report room',
                icon: const Icon(Icons.flag_outlined),
                onPressed: _report,
              ),
            IconButton(
              key: const Key('room-leave'),
              tooltip: room.isHost ? 'End room' : 'Leave',
              icon: Icon(room.isHost ? Icons.stop_circle_outlined : Icons.logout),
              onPressed: _leave,
            ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: <Widget>[
              if (room.video && engine != null)
                SizedBox(
                  height: 200,
                  child: ListenableBuilder(
                    listenable: engine.changes,
                    builder: (_, _) => ColoredBox(
                      color: Colors.black,
                      child: room.isHost ? engine.localVideo() : engine.remoteVideo(),
                    ),
                  ),
                ),
              _Stage(
                room: room,
                onSpeakerTap: room.isHost ? _manage : (s) => _gift(to: s),
              ),
              if (room.isHost && room.seatRequests.isNotEmpty)
                _SeatRequests(room: room, onSeat: (p) => _run(() => _repo.seat(_token, widget.roomId, p.id))),
              _StageActions(
                room: room,
                micOn: _micOn,
                onMic: () async {
                  setState(() => _micOn = !_micOn);
                  await _engine?.setMicrophone(_micOn);
                },
                onAsk: () => _run(() => _repo.requestSeat(_token, widget.roomId)),
                onCancelAsk: () => _run(() => _repo.cancelSeatRequest(_token, widget.roomId)),
                onStepDown: () => _run(() => _repo.unseat(_token, widget.roomId, _myId(room))),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView.builder(
                  key: const Key('room-chat'),
                  reverse: true,
                  padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s3, vertical: RoseSpacing.s2),
                  itemCount: _messages.length,
                  itemBuilder: (_, i) {
                    final m = _messages[_messages.length - 1 - i];
                    return Padding(
                      key: Key('room-message-${m.id}'),
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Text.rich(
                        TextSpan(
                          children: <InlineSpan>[
                            TextSpan(
                              text: '${m.senderName}  ',
                              style: TextStyle(
                                fontWeight: FontWeight.w600,
                                color: m.senderId == room.hostId ? RoseColors.champagneGold : theme.colorScheme.primary,
                              ),
                            ),
                            TextSpan(text: m.body),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(RoseSpacing.s2, 0, RoseSpacing.s2, RoseSpacing.s2),
                child: Row(
                  children: <Widget>[
                    if (!room.isHost)
                      IconButton(
                        key: const Key('room-gift'),
                        tooltip: 'Send a gift',
                        icon: const Icon(Icons.card_giftcard_outlined),
                        onPressed: _gift,
                      ),
                    Expanded(
                      child: TextField(
                        key: const Key('room-chat-input'),
                        controller: _input,
                        maxLength: 500,
                        onSubmitted: (_) => _send(),
                        decoration: const InputDecoration(hintText: 'Say something nice', counterText: ''),
                      ),
                    ),
                    IconButton.filled(
                      key: const Key('room-chat-send'),
                      tooltip: 'Send',
                      onPressed: _send,
                      icon: const Icon(Icons.send_rounded),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _myId(Room room) => room.myId;

  Map<String, dynamic> _roomJson(Room room) => <String, dynamic>{
    'id': room.id,
    'title': room.title,
    'mode': room.video ? 'video' : 'audio',
    'audience': room.followersOnly ? 'followers' : 'open',
    'status': room.live ? 'live' : 'ended',
    'max_seats': room.maxSeats,
    'host': <String, dynamic>{'id': room.hostId, 'first_name': room.hostName},
    'speakers': <Map<String, dynamic>>[
      for (final s in room.speakers)
        <String, dynamic>{
          'id': s.id,
          'first_name': s.firstName,
          'role': s.isHost ? 'host' : 'speaker',
          'muted_by_host': s.mutedByHost,
        },
    ],
    'listeners': room.listeners,
    'seat_requests': <Map<String, dynamic>>[
      for (final p in room.seatRequests) <String, dynamic>{'id': p.id, 'first_name': p.firstName},
    ],
  };

  Map<String, dynamic> _meJson(Room room, bool following) => <String, dynamic>{
    'id': room.myId,
    'role': room.myRole == RoomRole.none ? null : room.myRole.name,
    'seat_requested': room.seatRequested,
    'muted_by_host': room.mutedByHost,
    'following': following,
  };
}

class _Stage extends StatelessWidget {
  const _Stage({required this.room, required this.onSpeakerTap});

  final Room room;
  final void Function(RoomSpeaker) onSpeakerTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: RoseSpacing.s3, horizontal: RoseSpacing.s2),
      child: Wrap(
        alignment: WrapAlignment.center,
        spacing: RoseSpacing.s3,
        runSpacing: RoseSpacing.s2,
        children: <Widget>[
          for (final s in room.speakers)
            InkWell(
              key: Key('room-speaker-${s.id}'),
              borderRadius: BorderRadius.circular(40),
              onTap: s.isHost && room.isHost ? null : () => onSpeakerTap(s),
              child: SizedBox(
                width: 68,
                child: Column(
                  children: <Widget>[
                    Stack(
                      clipBehavior: Clip.none,
                      children: <Widget>[
                        CircleAvatar(
                          radius: 28,
                          backgroundColor: s.isHost ? RoseColors.burgundy : theme.colorScheme.secondaryContainer,
                          child: Text(
                            s.firstName.isEmpty ? '?' : s.firstName.characters.first.toUpperCase(),
                            style: TextStyle(
                              fontSize: 22,
                              color: s.isHost ? RoseColors.warmIvory : theme.colorScheme.onSecondaryContainer,
                            ),
                          ),
                        ),
                        if (s.isHost)
                          const Positioned(top: -8, right: -4, child: Text('👑', style: TextStyle(fontSize: 18))),
                        if (s.mutedByHost)
                          Positioned(
                            bottom: -2,
                            right: -2,
                            child: CircleAvatar(
                              radius: 10,
                              backgroundColor: theme.colorScheme.error,
                              child: const Icon(Icons.mic_off, size: 12, color: Colors.white),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(s.firstName, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.labelMedium),
                  ],
                ),
              ),
            ),
          for (var i = room.guestSeatsTaken; i < room.maxSeats; i++)
            SizedBox(
              width: 68,
              child: Column(
                children: <Widget>[
                  CircleAvatar(
                    radius: 28,
                    backgroundColor: theme.colorScheme.surfaceContainerHighest,
                    child: Icon(Icons.event_seat_outlined, color: theme.colorScheme.outline),
                  ),
                  const SizedBox(height: 4),
                  Text('Open seat', style: theme.textTheme.labelSmall),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _SeatRequests extends StatelessWidget {
  const _SeatRequests({required this.room, required this.onSeat});

  final Room room;
  final void Function(RoomPerson) onSeat;

  @override
  Widget build(BuildContext context) {
    final full = room.guestSeatsTaken >= room.maxSeats;
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: RoseSpacing.s3, vertical: RoseSpacing.s1),
      child: Column(
        children: <Widget>[
          ListTile(dense: true, title: Text('Asking to speak (${room.seatRequests.length})')),
          for (final p in room.seatRequests)
            ListTile(
              key: Key('room-request-${p.id}'),
              dense: true,
              title: Text(p.firstName),
              trailing: FilledButton.tonal(
                key: Key('room-seat-${p.id}'),
                style: _compact,
                onPressed: full ? null : () => onSeat(p),
                child: Text(full ? 'Full' : 'Invite'),
              ),
            ),
        ],
      ),
    );
  }
}

class _StageActions extends StatelessWidget {
  const _StageActions({
    required this.room,
    required this.micOn,
    required this.onMic,
    required this.onAsk,
    required this.onCancelAsk,
    required this.onStepDown,
  });

  final Room room;
  final bool micOn;
  final VoidCallback onMic, onAsk, onCancelAsk, onStepDown;

  @override
  Widget build(BuildContext context) {
    final children = <Widget>[
      if (room.canSpeak)
        FilledButton.tonalIcon(
          key: const Key('room-mic'),
          style: _compact,
          onPressed: onMic,
          icon: Icon(micOn ? Icons.mic : Icons.mic_off),
          label: Text(micOn ? 'Mute' : 'Unmute'),
        ),
      if (room.myRole == RoomRole.speaker)
        OutlinedButton(
          key: const Key('room-step-down'),
          style: _compact,
          onPressed: onStepDown,
          child: const Text('Leave stage'),
        ),
      if (room.myRole == RoomRole.speaker && room.mutedByHost)
        const Chip(key: Key('room-muted-by-host'), label: Text('The Host muted you')),
      if (room.myRole == RoomRole.listener && !room.seatRequested)
        FilledButton.icon(
          key: const Key('room-ask-seat'),
          style: _compact,
          onPressed: onAsk,
          icon: const Icon(Icons.pan_tool_alt_outlined),
          label: const Text('Ask to speak'),
        ),
      if (room.myRole == RoomRole.listener && room.seatRequested)
        OutlinedButton.icon(
          key: const Key('room-cancel-ask'),
          style: _compact,
          onPressed: onCancelAsk,
          icon: const Icon(Icons.hourglass_top),
          label: const Text('Request sent · Cancel'),
        ),
    ];
    if (children.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: RoseSpacing.s2),
      child: Wrap(
        alignment: WrapAlignment.center,
        spacing: RoseSpacing.s2,
        runSpacing: RoseSpacing.s1,
        children: children,
      ),
    );
  }
}

/// The theme's buttons are full width; on the stage they sit side by side.
const ButtonStyle _compact = ButtonStyle(minimumSize: WidgetStatePropertyAll<Size>(Size(0, 40)));
