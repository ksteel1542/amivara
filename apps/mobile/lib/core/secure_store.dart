import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Small key-value store for secrets (refresh token, install id).
/// Backed by Android Keystore-encrypted storage; tests use [MemoryStore].
abstract interface class SecureStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class DeviceSecureStore implements SecureStore {
  const DeviceSecureStore([this._storage = const FlutterSecureStorage()]);

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class MemoryStore implements SecureStore {
  final Map<String, String> values = <String, String>{};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

abstract final class StoreKeys {
  static const String refreshToken = 'amivara.refresh_token';
  static const String deviceId = 'amivara.device_id';
}

/// Random install id (UUID v4 format), created once and kept in secure storage.
/// Not derived from hardware: it identifies this install, not the phone.
Future<String> loadOrCreateDeviceId(SecureStore store) async {
  final existing = await store.read(StoreKeys.deviceId);
  if (existing != null) return existing;
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  final id =
      '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  await store.write(StoreKeys.deviceId, id);
  return id;
}
