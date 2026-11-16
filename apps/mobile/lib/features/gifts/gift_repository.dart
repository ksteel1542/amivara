import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../chat/chat_repository.dart';

/// One gift in the catalogue (GET /gifts).
class Gift {
  const Gift({required this.id, required this.slug, required this.name, required this.emoji, required this.priceCoins});

  factory Gift.fromJson(Map<String, dynamic> json) => Gift(
    id: json['id'] as String,
    slug: json['slug'] as String,
    name: json['name'] as String,
    emoji: json['emoji'] as String,
    priceCoins: (json['price_coins'] as num).toInt(),
  );

  final String id;
  final String slug;
  final String name;
  final String emoji;
  final int priceCoins;
}

abstract interface class GiftRepository {
  Future<List<Gift>> catalogue(String accessToken);

  /// A gift in a 1-on-1 chat: the gift message, and the sender's balance after.
  Future<({ChatMessage message, int balance})> sendInChat(
    String accessToken,
    String matchId,
    String giftId,
    String idempotencyKey,
  );

  /// A gift in a Chat House room (to the Host unless [recipientId]); the balance after.
  Future<int> sendInRoom(
    String accessToken,
    String roomId,
    String giftId,
    String idempotencyKey, {
    String? recipientId,
  });
}

class HttpGiftRepository implements GiftRepository {
  const HttpGiftRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<Gift>> catalogue(String accessToken) async {
    final json = await _api.get('/gifts', bearer: accessToken);
    return (json['gifts'] as List<dynamic>).cast<Map<String, dynamic>>().map(Gift.fromJson).toList();
  }

  @override
  Future<({ChatMessage message, int balance})> sendInChat(
    String accessToken,
    String matchId,
    String giftId,
    String idempotencyKey,
  ) async {
    final json = await _api.post(
      '/matches/$matchId/gifts',
      bearer: accessToken,
      body: <String, dynamic>{'gift_id': giftId, 'idempotency_key': idempotencyKey},
    );
    return (
      message: ChatMessage.fromJson(json['message'] as Map<String, dynamic>),
      balance: (json['balance'] as num).toInt(),
    );
  }

  @override
  Future<int> sendInRoom(
    String accessToken,
    String roomId,
    String giftId,
    String idempotencyKey, {
    String? recipientId,
  }) async {
    final json = await _api.post(
      '/rooms/$roomId/gifts',
      bearer: accessToken,
      body: <String, dynamic>{'gift_id': giftId, 'idempotency_key': idempotencyKey, 'recipient_id': ?recipientId},
    );
    return (json['balance'] as num).toInt();
  }
}

/// A fresh key per tap: a retried request is never charged twice.
String newGiftKey() {
  final rnd = math.Random.secure();
  return List<String>.generate(24, (_) => rnd.nextInt(36).toRadixString(36)).join();
}

/// Overridden in main.dart and in tests.
final giftRepositoryProvider = Provider<GiftRepository>((ref) => throw UnimplementedError('override in main'));
