import '../../core/api_client.dart';

class MatchSummary {
  const MatchSummary({
    required this.matchId,
    required this.userId,
    required this.firstName,
    required this.age,
    required this.verified,
    required this.unreadCount,
    this.photoUrl,
    this.lastMessage,
    this.lastFromMe = false,
  });

  factory MatchSummary.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>;
    final last = json['last_message'] as Map<String, dynamic>?;
    return MatchSummary(
      matchId: json['match_id'] as String,
      userId: user['user_id'] as String,
      firstName: user['first_name'] as String,
      age: (user['age'] as num).toInt(),
      verified: user['verified'] as bool,
      photoUrl: user['photo_url'] as String?,
      lastMessage: last?['snippet'] as String?,
      lastFromMe: last?['from_me'] as bool? ?? false,
      unreadCount: (json['unread_count'] as num).toInt(),
    );
  }

  final String matchId;
  final String userId;
  final String firstName;
  final int age;
  final bool verified;
  final String? photoUrl;
  final String? lastMessage;
  final bool lastFromMe;
  final int unreadCount;
}

/// GET /matches, DELETE /matches/:id, POST /notifications/tokens.
abstract interface class MatchesRepository {
  Future<List<MatchSummary>> list(String accessToken);
  Future<void> unmatch(String accessToken, String matchId);
  Future<void> registerPushToken(String accessToken, String token);
}

class HttpMatchesRepository implements MatchesRepository {
  const HttpMatchesRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<MatchSummary>> list(String accessToken) async {
    final json = await _api.get('/matches', bearer: accessToken);
    return (json['matches'] as List<dynamic>).cast<Map<String, dynamic>>().map(MatchSummary.fromJson).toList();
  }

  @override
  Future<void> unmatch(String accessToken, String matchId) => _api.delete('/matches/$matchId', bearer: accessToken);

  @override
  Future<void> registerPushToken(String accessToken, String token) => _api.post(
    '/notifications/tokens',
    bearer: accessToken,
    body: <String, dynamic>{'token': token, 'platform': 'android'},
  );
}
