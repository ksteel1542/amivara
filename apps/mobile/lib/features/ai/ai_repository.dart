import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';

/// An AI Companion persona (GET /ai/companions). Always shown with the "AI Companion" label.
class AiCompanion {
  const AiCompanion({
    required this.slug,
    required this.name,
    required this.tagline,
    required this.bio,
    this.interests = const <String>[],
    this.label = 'AI Companion',
  });

  factory AiCompanion.fromJson(Map<String, dynamic> json) => AiCompanion(
    slug: json['slug'] as String,
    name: json['name'] as String,
    tagline: json['tagline'] as String? ?? '',
    bio: json['bio'] as String? ?? '',
    interests: ((json['interests'] as List<dynamic>?) ?? const <dynamic>[]).cast<String>(),
    label: json['label'] as String? ?? 'AI Companion',
  );

  final String slug;
  final String name;
  final String tagline;
  final String bio;
  final List<String> interests;
  final String label;
}

class AiMessage {
  const AiMessage({required this.id, required this.fromCompanion, required this.body, this.refunded = false});

  factory AiMessage.fromJson(Map<String, dynamic> json) => AiMessage(
    id: json['id'] as String,
    fromCompanion: json['role'] == 'companion',
    body: json['body'] as String,
    refunded: json['refunded'] as bool? ?? false,
  );

  final String id;
  final bool fromCompanion;
  final String body;
  final bool refunded;
}

class AiBilling {
  const AiBilling({required this.priceCoins, required this.freePerDay, required this.freeRemainingToday});

  factory AiBilling.fromJson(Map<String, dynamic>? json) => AiBilling(
    priceCoins: (json?['price_coins'] as num?)?.toInt() ?? 0,
    freePerDay: (json?['free_per_day'] as num?)?.toInt() ?? 0,
    freeRemainingToday: (json?['free_remaining_today'] as num?)?.toInt() ?? 0,
  );

  final int priceCoins;
  final int freePerDay;
  final int freeRemainingToday;
}

class AiConversation {
  const AiConversation({required this.id, required this.companion, required this.messages, required this.billing});

  factory AiConversation.fromJson(Map<String, dynamic> json) => AiConversation(
    id: json['id'] as String,
    companion: AiCompanion.fromJson(json['companion'] as Map<String, dynamic>),
    messages: (json['messages'] as List<dynamic>).cast<Map<String, dynamic>>().map(AiMessage.fromJson).toList(),
    billing: AiBilling.fromJson(json['billing'] as Map<String, dynamic>?),
  );

  final String id;
  final AiCompanion companion;

  /// Newest first.
  final List<AiMessage> messages;
  final AiBilling billing;
}

class AiSendResult {
  const AiSendResult({required this.message, required this.reply, required this.balance, required this.billing});

  final AiMessage message;
  final AiMessage reply;
  final int? balance;
  final AiBilling billing;
}

/// Member spending protections (GET /me/spend-limits).
class SpendLimits {
  const SpendLimits({this.aiDailyCapCoins, this.effectiveCap, this.spentToday = 0, this.selfExcludedUntil});

  factory SpendLimits.fromJson(Map<String, dynamic> json) => SpendLimits(
    aiDailyCapCoins: (json['ai_daily_cap_coins'] as num?)?.toInt(),
    effectiveCap: (json['effective_ai_daily_cap_coins'] as num?)?.toInt(),
    spentToday: (json['ai_spent_today'] as num?)?.toInt() ?? 0,
    selfExcludedUntil: json['self_excluded_until'] == null
        ? null
        : DateTime.parse(json['self_excluded_until'] as String),
  );

  final int? aiDailyCapCoins;
  final int? effectiveCap;
  final int spentToday;
  final DateTime? selfExcludedUntil;
}

abstract interface class AiRepository {
  Future<({bool available, List<AiCompanion> companions})> companions(String accessToken);
  Future<AiConversation> open(String accessToken, String slug);
  Future<AiSendResult> send(String accessToken, String conversationId, String body);
  Future<void> report(String accessToken, String messageId);
  Future<void> delete(String accessToken, String conversationId);
  Future<SpendLimits> limits(String accessToken);
  Future<SpendLimits> setCap(String accessToken, int? cap);
  Future<SpendLimits> selfExclude(String accessToken, int days);
}

class HttpAiRepository implements AiRepository {
  const HttpAiRepository(this._api);

  final ApiClient _api;

  @override
  Future<({bool available, List<AiCompanion> companions})> companions(String accessToken) async {
    final json = await _api.get('/ai/companions', bearer: accessToken);
    return (
      available: json['available'] as bool? ?? false,
      companions: (json['companions'] as List<dynamic>).cast<Map<String, dynamic>>().map(AiCompanion.fromJson).toList(),
    );
  }

  @override
  Future<AiConversation> open(String accessToken, String slug) async =>
      AiConversation.fromJson(await _api.post('/ai/companions/$slug/conversation', bearer: accessToken));

  @override
  Future<AiSendResult> send(String accessToken, String conversationId, String body) async {
    final json = await _api.post(
      '/ai/conversations/$conversationId/messages',
      bearer: accessToken,
      body: <String, dynamic>{'body': body},
    );
    return AiSendResult(
      message: AiMessage.fromJson(json['message'] as Map<String, dynamic>),
      reply: AiMessage.fromJson(json['reply'] as Map<String, dynamic>),
      balance: (json['balance'] as num?)?.toInt(),
      billing: AiBilling.fromJson(json['billing'] as Map<String, dynamic>?),
    );
  }

  @override
  Future<void> report(String accessToken, String messageId) =>
      _api.post('/ai/messages/$messageId/report', bearer: accessToken);

  @override
  Future<void> delete(String accessToken, String conversationId) =>
      _api.delete('/ai/conversations/$conversationId', bearer: accessToken);

  @override
  Future<SpendLimits> limits(String accessToken) async =>
      SpendLimits.fromJson(await _api.get('/me/spend-limits', bearer: accessToken));

  @override
  Future<SpendLimits> setCap(String accessToken, int? cap) async => SpendLimits.fromJson(
    await _api.put('/me/spend-limits', bearer: accessToken, body: <String, dynamic>{'ai_daily_cap_coins': cap}),
  );

  @override
  Future<SpendLimits> selfExclude(String accessToken, int days) async => SpendLimits.fromJson(
    await _api.post('/me/spend-limits/self-exclude', bearer: accessToken, body: <String, dynamic>{'days': days}),
  );
}

/// Overridden in main.dart and in tests.
final aiRepositoryProvider = Provider<AiRepository>((ref) => throw UnimplementedError('override in main'));
