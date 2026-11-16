import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';

enum CallType {
  voice,
  video;

  static CallType parse(String? s) => s == 'video' ? CallType.video : CallType.voice;
}

/// A call as the server sees it (API.md "Calls"). [role] is this member's side.
class CallInfo {
  const CallInfo({
    required this.id,
    required this.matchId,
    required this.type,
    required this.status,
    required this.isCaller,
    required this.otherUserId,
    this.ratePerMinute = 0,
    this.startedAt,
    this.billedMinutes = 0,
    this.totalCoinsBilled,
    this.endReason,
  });

  factory CallInfo.fromJson(Map<String, dynamic> json) => CallInfo(
    id: json['id'] as String,
    matchId: json['match_id'] as String,
    type: CallType.parse(json['type'] as String?),
    status: json['status'] as String,
    isCaller: json['role'] == 'caller',
    otherUserId: json['other_user_id'] as String? ?? '',
    ratePerMinute: (json['rate_per_minute'] as num?)?.toInt() ?? 0,
    startedAt: json['started_at'] == null ? null : DateTime.parse(json['started_at'] as String),
    billedMinutes: (json['billed_minutes'] as num?)?.toInt() ?? 0,
    totalCoinsBilled: (json['total_coins_billed'] as num?)?.toInt(),
    endReason: json['end_reason'] as String?,
  );

  final String id;
  final String matchId;
  final CallType type;

  /// ringing, active, ended, declined, missed, cancelled, insufficient_coins.
  final String status;
  final bool isCaller;
  final String otherUserId;

  /// Coins per started minute, paid by the caller. 0 = free.
  final int ratePerMinute;
  final DateTime? startedAt;
  final int billedMinutes;
  final int? totalCoinsBilled;
  final String? endReason;

  bool get paid => ratePerMinute > 0;
  bool get video => type == CallType.video;
  bool get live => status == 'ringing' || status == 'active';
}

/// Where and how to join the call's media room.
class CallMedia {
  const CallMedia({required this.url, required this.token});

  factory CallMedia.fromJson(Map<String, dynamic> json) =>
      CallMedia(url: json['url'] as String, token: json['token'] as String);

  final String url;
  final String token;
}

/// GET /matches/:id/calls/quote: whether the chat header offers calls, and their price.
class CallQuote {
  const CallQuote({
    required this.available,
    required this.allowed,
    required this.paid,
    required this.voiceRate,
    required this.videoRate,
  });

  factory CallQuote.fromJson(Map<String, dynamic> json) => CallQuote(
    available: json['available'] as bool? ?? false,
    allowed: json['allowed'] as bool? ?? false,
    paid: json['paid'] as bool? ?? false,
    voiceRate: (json['voice_rate_per_minute'] as num?)?.toInt() ?? 0,
    videoRate: (json['video_rate_per_minute'] as num?)?.toInt() ?? 0,
  );

  final bool available;

  /// Both members passed NIN verification.
  final bool allowed;
  final bool paid;
  final int voiceRate;
  final int videoRate;

  int rateFor(CallType type) => type == CallType.video ? videoRate : voiceRate;
}

abstract interface class CallRepository {
  Future<CallQuote> quote(String accessToken, String matchId);
  Future<CallInfo> start(String accessToken, String matchId, CallType type);
  Future<({CallInfo call, CallMedia media})> accept(String accessToken, String callId);
  Future<({CallInfo call, CallMedia media, int? balance})> join(String accessToken, String callId);
  Future<CallInfo> decline(String accessToken, String callId);
  Future<CallInfo> end(String accessToken, String callId);

  /// The member's live call (ringing or active), with the other member's first name.
  Future<({CallInfo call, String otherName})?> current(String accessToken);
}

class HttpCallRepository implements CallRepository {
  const HttpCallRepository(this._api);

  final ApiClient _api;

  CallInfo _call(Map<String, dynamic> json) => CallInfo.fromJson(json['call'] as Map<String, dynamic>);

  @override
  Future<CallQuote> quote(String accessToken, String matchId) async =>
      CallQuote.fromJson(await _api.get('/matches/$matchId/calls/quote', bearer: accessToken));

  @override
  Future<CallInfo> start(String accessToken, String matchId, CallType type) async => _call(
    await _api.post('/matches/$matchId/calls', bearer: accessToken, body: <String, dynamic>{'type': type.name}),
  );

  @override
  Future<({CallInfo call, CallMedia media})> accept(String accessToken, String callId) async {
    final json = await _api.post('/calls/$callId/accept', bearer: accessToken);
    return (call: _call(json), media: CallMedia.fromJson(json['media'] as Map<String, dynamic>));
  }

  @override
  Future<({CallInfo call, CallMedia media, int? balance})> join(String accessToken, String callId) async {
    final json = await _api.post('/calls/$callId/join', bearer: accessToken);
    return (
      call: _call(json),
      media: CallMedia.fromJson(json['media'] as Map<String, dynamic>),
      balance: (json['balance'] as num?)?.toInt(),
    );
  }

  @override
  Future<CallInfo> decline(String accessToken, String callId) async =>
      _call(await _api.post('/calls/$callId/decline', bearer: accessToken));

  @override
  Future<CallInfo> end(String accessToken, String callId) async =>
      _call(await _api.post('/calls/$callId/end', bearer: accessToken));

  @override
  Future<({CallInfo call, String otherName})?> current(String accessToken) async {
    final json = await _api.get('/calls/current', bearer: accessToken);
    if (json['call'] == null) return null;
    return (call: _call(json), otherName: (json['other'] as Map<String, dynamic>?)?['first_name'] as String? ?? '');
  }
}

/// Overridden in main.dart and in tests.
final callRepositoryProvider = Provider<CallRepository>((ref) => throw UnimplementedError('override in main'));
