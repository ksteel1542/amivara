import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../calls/call_repository.dart';

/// A live room in the list (GET /rooms).
class RoomSummary {
  const RoomSummary({
    required this.id,
    required this.title,
    required this.video,
    required this.followersOnly,
    required this.hostId,
    required this.hostName,
    required this.following,
    required this.listeners,
  });

  factory RoomSummary.fromJson(Map<String, dynamic> json) {
    final host = json['host'] as Map<String, dynamic>;
    return RoomSummary(
      id: json['id'] as String,
      title: json['title'] as String,
      video: json['mode'] == 'video',
      followersOnly: json['audience'] == 'followers',
      hostId: host['id'] as String,
      hostName: host['first_name'] as String? ?? '',
      following: json['following'] as bool? ?? false,
      listeners: (json['listeners'] as num?)?.toInt() ?? 0,
    );
  }

  final String id;
  final String title;
  final bool video;
  final bool followersOnly;
  final String hostId;
  final String hostName;
  final bool following;
  final int listeners;
}

class RoomSpeaker {
  const RoomSpeaker({required this.id, required this.firstName, required this.isHost, this.mutedByHost = false});

  final String id;
  final String firstName;
  final bool isHost;
  final bool mutedByHost;
}

class RoomPerson {
  const RoomPerson({required this.id, required this.firstName});

  final String id;
  final String firstName;
}

enum RoomRole { host, speaker, listener, none }

/// A room as this member sees it (GET /rooms/:id, room:updated).
class Room {
  const Room({
    required this.id,
    required this.title,
    required this.video,
    required this.followersOnly,
    required this.live,
    required this.maxSeats,
    required this.hostId,
    required this.hostName,
    required this.speakers,
    required this.listeners,
    required this.seatRequests,
    required this.myRole,
    required this.seatRequested,
    required this.mutedByHost,
    required this.following,
    this.myId = '',
  });

  factory Room.fromJson(Map<String, dynamic> json) {
    final host = json['host'] as Map<String, dynamic>;
    final me = json['me'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    return Room(
      id: json['id'] as String,
      title: json['title'] as String,
      video: json['mode'] == 'video',
      followersOnly: json['audience'] == 'followers',
      live: json['status'] == 'live',
      maxSeats: (json['max_seats'] as num?)?.toInt() ?? 8,
      hostId: host['id'] as String,
      hostName: host['first_name'] as String? ?? '',
      speakers: ((json['speakers'] as List<dynamic>?) ?? const <dynamic>[])
          .cast<Map<String, dynamic>>()
          .map(
            (s) => RoomSpeaker(
              id: s['id'] as String,
              firstName: s['first_name'] as String? ?? '',
              isHost: s['role'] == 'host',
              mutedByHost: s['muted_by_host'] as bool? ?? false,
            ),
          )
          .toList(),
      listeners: (json['listeners'] as num?)?.toInt() ?? 0,
      seatRequests: ((json['seat_requests'] as List<dynamic>?) ?? const <dynamic>[])
          .cast<Map<String, dynamic>>()
          .map((p) => RoomPerson(id: p['id'] as String, firstName: p['first_name'] as String? ?? ''))
          .toList(),
      myRole: switch (me['role']) {
        'host' => RoomRole.host,
        'speaker' => RoomRole.speaker,
        'listener' => RoomRole.listener,
        _ => RoomRole.none,
      },
      seatRequested: me['seat_requested'] as bool? ?? false,
      mutedByHost: me['muted_by_host'] as bool? ?? false,
      following: me['following'] as bool? ?? false,
      myId: me['id'] as String? ?? '',
    );
  }

  final String id;
  final String title;
  final bool video;
  final bool followersOnly;
  final bool live;
  final int maxSeats;
  final String hostId;
  final String hostName;

  /// The Host first, then seated guests.
  final List<RoomSpeaker> speakers;
  final int listeners;

  /// Only filled for the Host.
  final List<RoomPerson> seatRequests;
  final RoomRole myRole;
  final bool seatRequested;
  final bool mutedByHost;
  final bool following;

  /// The viewer's own member id.
  final String myId;

  bool get isHost => myRole == RoomRole.host;

  /// This member may publish audio (and video) right now.
  bool get canSpeak => (myRole == RoomRole.host || myRole == RoomRole.speaker) && !mutedByHost;
  int get guestSeatsTaken => speakers.where((s) => !s.isHost).length;
}

class RoomMessage {
  const RoomMessage({required this.id, required this.senderId, required this.senderName, required this.body});

  factory RoomMessage.fromJson(Map<String, dynamic> json) {
    final sender = json['sender'] as Map<String, dynamic>;
    return RoomMessage(
      id: json['id'] as String,
      senderId: sender['id'] as String,
      senderName: sender['first_name'] as String? ?? '',
      body: json['body'] as String,
    );
  }

  final String id;
  final String senderId;
  final String senderName;
  final String body;
}

abstract interface class RoomsRepository {
  Future<List<RoomSummary>> list(String accessToken);
  Future<({Room room, CallMedia media})> open(
    String accessToken, {
    required String title,
    required bool video,
    required bool followersOnly,
  });
  Future<({Room room, CallMedia media})> join(String accessToken, String roomId);
  Future<void> leave(String accessToken, String roomId);
  Future<void> end(String accessToken, String roomId);
  Future<void> requestSeat(String accessToken, String roomId);
  Future<void> cancelSeatRequest(String accessToken, String roomId);
  Future<void> seat(String accessToken, String roomId, String userId);
  Future<void> unseat(String accessToken, String roomId, String userId);
  Future<void> setMuted(String accessToken, String roomId, String userId, bool muted);
  Future<void> ban(String accessToken, String roomId, String userId);
  Future<List<RoomMessage>> messages(String accessToken, String roomId);
  Future<RoomMessage> send(String accessToken, String roomId, String body);
  Future<void> follow(String accessToken, String hostId, bool follow);
  Future<void> report(String accessToken, String roomId, {required String category, String? details});
}

class HttpRoomsRepository implements RoomsRepository {
  const HttpRoomsRepository(this._api);

  final ApiClient _api;

  ({Room room, CallMedia media}) _joined(Map<String, dynamic> json) => (
    room: Room.fromJson(json['room'] as Map<String, dynamic>),
    media: CallMedia.fromJson(json['media'] as Map<String, dynamic>),
  );

  @override
  Future<List<RoomSummary>> list(String accessToken) async {
    final json = await _api.get('/rooms', bearer: accessToken);
    return (json['rooms'] as List<dynamic>).cast<Map<String, dynamic>>().map(RoomSummary.fromJson).toList();
  }

  @override
  Future<({Room room, CallMedia media})> open(
    String accessToken, {
    required String title,
    required bool video,
    required bool followersOnly,
  }) async => _joined(
    await _api.post(
      '/rooms',
      bearer: accessToken,
      body: <String, dynamic>{
        'title': title,
        'mode': video ? 'video' : 'audio',
        'audience': followersOnly ? 'followers' : 'open',
      },
    ),
  );

  @override
  Future<({Room room, CallMedia media})> join(String accessToken, String roomId) async =>
      _joined(await _api.post('/rooms/$roomId/join', bearer: accessToken));

  @override
  Future<void> leave(String accessToken, String roomId) => _api.post('/rooms/$roomId/leave', bearer: accessToken);

  @override
  Future<void> end(String accessToken, String roomId) => _api.post('/rooms/$roomId/end', bearer: accessToken);

  @override
  Future<void> requestSeat(String accessToken, String roomId) =>
      _api.post('/rooms/$roomId/seat-request', bearer: accessToken);

  @override
  Future<void> cancelSeatRequest(String accessToken, String roomId) =>
      _api.delete('/rooms/$roomId/seat-request', bearer: accessToken);

  @override
  Future<void> seat(String accessToken, String roomId, String userId) =>
      _api.post('/rooms/$roomId/speakers/$userId', bearer: accessToken);

  @override
  Future<void> unseat(String accessToken, String roomId, String userId) =>
      _api.post('/rooms/$roomId/speakers/$userId/remove', bearer: accessToken);

  @override
  Future<void> setMuted(String accessToken, String roomId, String userId, bool muted) =>
      _api.post('/rooms/$roomId/${muted ? 'mute' : 'unmute'}/$userId', bearer: accessToken);

  @override
  Future<void> ban(String accessToken, String roomId, String userId) =>
      _api.post('/rooms/$roomId/ban/$userId', bearer: accessToken);

  @override
  Future<List<RoomMessage>> messages(String accessToken, String roomId) async {
    final json = await _api.get('/rooms/$roomId/messages', bearer: accessToken);
    return (json['messages'] as List<dynamic>).cast<Map<String, dynamic>>().map(RoomMessage.fromJson).toList();
  }

  @override
  Future<RoomMessage> send(String accessToken, String roomId, String body) async {
    final json = await _api.post('/rooms/$roomId/messages', bearer: accessToken, body: <String, dynamic>{'body': body});
    return RoomMessage.fromJson(json['message'] as Map<String, dynamic>);
  }

  @override
  Future<void> follow(String accessToken, String hostId, bool follow) => follow
      ? _api.post('/hosts/$hostId/follow', bearer: accessToken)
      : _api.delete('/hosts/$hostId/follow', bearer: accessToken);

  @override
  Future<void> report(String accessToken, String roomId, {required String category, String? details}) => _api.post(
    '/rooms/$roomId/report',
    bearer: accessToken,
    body: <String, dynamic>{'category': category, if (details != null && details.isNotEmpty) 'details': details},
  );
}

/// Overridden in main.dart and in tests.
final roomsRepositoryProvider = Provider<RoomsRepository>((ref) => throw UnimplementedError('override in main'));
