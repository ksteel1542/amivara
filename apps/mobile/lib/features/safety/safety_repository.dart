import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';

/// PRD §5.6 report categories, in the order the sheet lists them.
enum ReportCategory {
  fakeProfile('fake_profile', 'Fake profile', 'Photos or details that aren\'t really them'),
  underage('underage', 'May be under 18', 'We suspend the account straight away while we review'),
  harassment('harassment', 'Harassment or threats', 'Abusive, threatening or won\'t take no for an answer'),
  scam('scam', 'Scam or asking for money', 'Money, gifts, transport fare, crypto or investment requests'),
  explicitContent('explicit_content', 'Explicit content', 'Sexual photos or messages you didn\'t ask for'),
  hate('hate', 'Hate', 'Attacks on ethnicity, religion, gender or sexuality'),
  other('other', 'Something else', 'Tell us what happened');

  const ReportCategory(this.apiValue, this.label, this.hint);

  final String apiValue;
  final String label;
  final String hint;
}

/// Someone you've blocked (GET /safety/blocks).
class BlockedMember {
  const BlockedMember({required this.userId, required this.firstName, required this.blockedAt});

  factory BlockedMember.fromJson(Map<String, dynamic> json) => BlockedMember(
    userId: json['user_id'] as String,
    firstName: json['first_name'] as String?,
    blockedAt: DateTime.parse(json['blocked_at'] as String),
  );

  final String userId;
  final String? firstName;
  final DateTime blockedAt;
}

/// API.md "Safety". Open to every signed-in member, verified or not.
abstract interface class SafetyRepository {
  Future<void> block(String accessToken, String userId);
  Future<List<BlockedMember>> blocks(String accessToken);
  Future<void> unblock(String accessToken, String userId);
  Future<void> report(
    String accessToken, {
    required String userId,
    required ReportCategory category,
    String? details,
    String? messageId,
  });
}

class HttpSafetyRepository implements SafetyRepository {
  const HttpSafetyRepository(this._api);

  final ApiClient _api;

  @override
  Future<void> block(String accessToken, String userId) =>
      _api.post('/safety/blocks', bearer: accessToken, body: <String, dynamic>{'user_id': userId});

  @override
  Future<List<BlockedMember>> blocks(String accessToken) async =>
      ((await _api.get('/safety/blocks', bearer: accessToken))['blocks'] as List<dynamic>)
          .cast<Map<String, dynamic>>()
          .map(BlockedMember.fromJson)
          .toList();

  @override
  Future<void> unblock(String accessToken, String userId) => _api.delete('/safety/blocks/$userId', bearer: accessToken);

  @override
  Future<void> report(
    String accessToken, {
    required String userId,
    required ReportCategory category,
    String? details,
    String? messageId,
  }) => _api.post(
    '/safety/reports',
    bearer: accessToken,
    body: <String, dynamic>{
      'user_id': userId,
      'category': category.apiValue,
      if (details != null && details.trim().isNotEmpty) 'details': details.trim(),
      'message_id': ?messageId,
    },
  );
}

/// Overridden in main.dart and in tests.
final safetyRepositoryProvider = Provider<SafetyRepository>((ref) => throw UnimplementedError('override in main'));
