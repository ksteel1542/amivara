import '../../core/api_client.dart';

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.matchId,
    required this.senderId,
    required this.body,
    required this.createdAt,
    this.readAt,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
    id: json['id'] as String,
    matchId: json['match_id'] as String,
    senderId: json['sender_id'] as String,
    body: json['body'] as String? ?? '',
    createdAt: DateTime.parse(json['created_at'] as String),
    readAt: json['read_at'] == null ? null : DateTime.parse(json['read_at'] as String),
  );

  final String id;
  final String matchId;
  final String senderId;
  final String body;
  final DateTime createdAt;
  final DateTime? readAt;

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

class ChatPage {
  const ChatPage({required this.messages, required this.photos, this.nextBefore});

  /// Newest first.
  final List<ChatMessage> messages;
  final String? nextBefore;
  final PhotoUnlock photos;
}

/// REST side of chat (API.md "Messaging"): history, the send fallback and read receipts.
abstract interface class ChatRepository {
  Future<ChatPage> history(String accessToken, String matchId, {String? before});
  Future<ChatMessage> send(String accessToken, String matchId, String body);
  Future<void> markRead(String accessToken, String matchId, String upToMessageId);
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
}
