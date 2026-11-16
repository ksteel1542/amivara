import '../../core/api_client.dart';

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.matchId,
    required this.senderId,
    required this.body,
    required this.createdAt,
    this.readAt,
    this.safetyNotice,
    this.coinsCharged = 0,
    this.balanceAfter,
    this.freeRemainingToday,
    this.gift,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
    id: json['id'] as String,
    matchId: json['match_id'] as String,
    senderId: json['sender_id'] as String,
    body: json['body'] as String? ?? '',
    createdAt: DateTime.parse(json['created_at'] as String),
    readAt: json['read_at'] == null ? null : DateTime.parse(json['read_at'] as String),
    safetyNotice: json['safety_notice'] as String?,
    coinsCharged: (json['coins_charged'] as num?)?.toInt() ?? 0,
    balanceAfter: (json['balance'] as num?)?.toInt(),
    freeRemainingToday: (json['free_remaining_today'] as num?)?.toInt(),
    gift: json['type'] == 'gift' && json['gift'] is Map<String, dynamic>
        ? GiftInfo.fromJson(json['gift'] as Map<String, dynamic>)
        : null,
  );

  final String id;
  final String matchId;
  final String senderId;
  final String body;
  final DateTime createdAt;
  final DateTime? readAt;

  /// Set on a send response when the message looked like moving off AMIVARA ("contact_sharing").
  final String? safetyNotice;

  /// On a send response (M3): coins this message cost, the balance after, and the
  /// free messages left today in a paid (Host) conversation.
  final int coinsCharged;
  final int? balanceAfter;
  final int? freeRemainingToday;

  /// A gift message (M6/7): what was sent. Null for text.
  final GiftInfo? gift;

  ChatMessage markRead(DateTime at) =>
      ChatMessage(id: id, matchId: matchId, senderId: senderId, body: body, createdAt: createdAt, readAt: at);
}

/// Progressive photo unlocking (PRD §5.5): photos open once both have sent [threshold] messages.
class PhotoUnlock {
  const PhotoUnlock({required this.unlocked, required this.threshold, required this.mine, required this.theirs});

  factory PhotoUnlock.fromJson(Map<String, dynamic> json) => PhotoUnlock(
    unlocked: json['unlocked'] as bool,
    threshold: (json['threshold'] as num).toInt(),
    mine: (json['mine'] as num).toInt(),
    theirs: (json['theirs'] as num).toInt(),
  );

  static const PhotoUnlock open = PhotoUnlock(unlocked: true, threshold: 3, mine: 3, theirs: 3);

  final bool unlocked;
  final int threshold;
  final int mine;
  final int theirs;

  PhotoUnlock copyWith({bool? unlocked, int? mine, int? theirs}) => PhotoUnlock(
    unlocked: unlocked ?? this.unlocked,
    threshold: threshold,
    mine: mine ?? this.mine,
    theirs: theirs ?? this.theirs,
  );
}

/// What this conversation costs the viewer (MONETIZATION_PLAN.md M3): messaging a
/// Verified Host is free for [freePerDay] messages a day, then [priceCoins] each.
class ChatBilling {
  const ChatBilling({
    required this.paid,
    required this.priceCoins,
    required this.freePerDay,
    required this.freeRemainingToday,
  });

  factory ChatBilling.fromJson(Map<String, dynamic> json) => ChatBilling(
    paid: json['paid'] as bool? ?? false,
    priceCoins: (json['price_coins'] as num?)?.toInt() ?? 0,
    freePerDay: (json['free_per_day'] as num?)?.toInt() ?? 0,
    freeRemainingToday: (json['free_remaining_today'] as num?)?.toInt() ?? 0,
  );

  static const ChatBilling free = ChatBilling(paid: false, priceCoins: 0, freePerDay: 0, freeRemainingToday: 0);

  final bool paid;
  final int priceCoins;
  final int freePerDay;
  final int freeRemainingToday;

  ChatBilling withFreeRemaining(int n) =>
      ChatBilling(paid: paid, priceCoins: priceCoins, freePerDay: freePerDay, freeRemainingToday: n);
}

class ChatPage {
  const ChatPage({
    required this.messages,
    required this.photos,
    this.nextBefore,
    this.billing = ChatBilling.free,
    this.hostTools = false,
  });

  /// Newest first.
  final List<ChatMessage> messages;
  final String? nextBefore;
  final PhotoUnlock photos;
  final ChatBilling billing;

  /// The viewer is an active Verified Host: show the icebreaker bar.
  final bool hostTools;
}

/// REST side of chat (API.md "Messaging"): history, the send fallback and read receipts.
abstract interface class ChatRepository {
  Future<ChatPage> history(String accessToken, String matchId, {String? before});
  Future<ChatMessage> send(String accessToken, String matchId, String body);
  Future<void> markRead(String accessToken, String matchId, String upToMessageId);

  /// One-tap conversation starters, for Verified Hosts (GET /matches/:id/icebreakers).
  Future<List<String>> icebreakers(String accessToken, String matchId);
}

class HttpChatRepository implements ChatRepository {
  const HttpChatRepository(this._api);

  final ApiClient _api;

  @override
  Future<ChatPage> history(String accessToken, String matchId, {String? before}) async {
    final query = before == null ? '' : '?before=${Uri.encodeQueryComponent(before)}';
    final json = await _api.get('/matches/$matchId/messages$query', bearer: accessToken);
    return ChatPage(
      messages: (json['messages'] as List<dynamic>).cast<Map<String, dynamic>>().map(ChatMessage.fromJson).toList(),
      nextBefore: json['next_before'] as String?,
      photos: PhotoUnlock.fromJson(json['photos'] as Map<String, dynamic>),
      billing: json['billing'] is Map<String, dynamic>
          ? ChatBilling.fromJson(json['billing'] as Map<String, dynamic>)
          : ChatBilling.free,
      hostTools: json['host_tools'] as bool? ?? false,
    );
  }

  @override
  Future<ChatMessage> send(String accessToken, String matchId, String body) async => ChatMessage.fromJson(
    await _api.post('/matches/$matchId/messages', bearer: accessToken, body: <String, dynamic>{'body': body}),
  );

  @override
  Future<void> markRead(String accessToken, String matchId, String upToMessageId) => _api.post(
    '/matches/$matchId/read',
    bearer: accessToken,
    body: <String, dynamic>{'up_to_message_id': upToMessageId},
  );

  @override
  Future<List<String>> icebreakers(String accessToken, String matchId) async {
    final json = await _api.get('/matches/$matchId/icebreakers', bearer: accessToken);
    return ((json['icebreakers'] as List<dynamic>?) ?? const <dynamic>[])
        .cast<Map<String, dynamic>>()
        .map((i) => i['text'] as String)
        .toList();
  }
}

/// The gift in a gift message: never its price.
class GiftInfo {
  const GiftInfo({required this.slug, required this.name, required this.emoji});

  factory GiftInfo.fromJson(Map<String, dynamic> json) =>
      GiftInfo(slug: json['slug'] as String, name: json['name'] as String, emoji: json['emoji'] as String);

  final String slug;
  final String name;
  final String emoji;
}
