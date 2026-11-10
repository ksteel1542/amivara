import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/api_client.dart';

class AccountSettings {
  const AccountSettings({required this.paused, required this.incognito});

  factory AccountSettings.fromJson(Map<String, dynamic> json) =>
      AccountSettings(paused: json['paused'] as bool, incognito: json['incognito'] as bool);

  final bool paused;
  final bool incognito;
}

class DeviceSession {
  const DeviceSession({
    required this.id,
    required this.current,
    required this.lastUsedAt,
    this.platform,
    this.deviceModel,
  });

  factory DeviceSession.fromJson(Map<String, dynamic> json) => DeviceSession(
    id: json['id'] as String,
    current: json['current'] as bool,
    lastUsedAt: DateTime.parse(json['last_used_at'] as String),
    platform: json['platform'] as String?,
    deviceModel: json['device_model'] as String?,
  );

  final String id;
  final bool current;
  final DateTime lastUsedAt;
  final String? platform;
  final String? deviceModel;

  String get label =>
      deviceModel ??
      switch (platform) {
        'android' => 'Android phone',
        'web' => 'Web browser',
        'ios' => 'iPhone',
        _ => 'Unknown device',
      };
}

/// API.md "Account controls & privacy" and the session routes under "Auth".
abstract interface class SettingsRepository {
  Future<AccountSettings> settings(String accessToken);
  Future<AccountSettings> update(String accessToken, {bool? paused, bool? incognito});
  Future<List<DeviceSession>> sessions(String accessToken);
  Future<void> revokeSession(String accessToken, String sessionId);
  Future<int> revokeOtherSessions(String accessToken);

  /// The NDPA export, pretty-printed JSON.
  Future<String> exportData(String accessToken);

  /// Starts the 30-day deletion. Returns when it will be erased.
  Future<DateTime> deleteAccount(String accessToken);
}

class HttpSettingsRepository implements SettingsRepository {
  const HttpSettingsRepository(this._api);

  final ApiClient _api;

  @override
  Future<AccountSettings> settings(String accessToken) async =>
      AccountSettings.fromJson(await _api.get('/users/me/settings', bearer: accessToken));

  @override
  Future<AccountSettings> update(String accessToken, {bool? paused, bool? incognito}) async => AccountSettings.fromJson(
    await _api.patch(
      '/users/me/settings',
      bearer: accessToken,
      body: <String, dynamic>{'paused': ?paused, 'incognito': ?incognito},
    ),
  );

  @override
  Future<List<DeviceSession>> sessions(String accessToken) async {
    final json = await _api.get('/auth/sessions', bearer: accessToken);
    return (json['sessions'] as List<dynamic>).cast<Map<String, dynamic>>().map(DeviceSession.fromJson).toList();
  }

  @override
  Future<void> revokeSession(String accessToken, String sessionId) =>
      _api.delete('/auth/sessions/$sessionId', bearer: accessToken);

  @override
  Future<int> revokeOtherSessions(String accessToken) async =>
      ((await _api.delete('/auth/sessions', bearer: accessToken))['revoked'] as num).toInt();

  @override
  Future<String> exportData(String accessToken) async =>
      const JsonEncoder.withIndent('  ').convert(await _api.get('/users/me/export', bearer: accessToken));

  @override
  Future<DateTime> deleteAccount(String accessToken) async =>
      DateTime.parse((await _api.delete('/users/me', bearer: accessToken))['purge_after'] as String);
}

/// Hands the export to the member: the Android share sheet (save to Files or Drive, email it…).
abstract interface class DataSaver {
  Future<void> save(String fileName, String json);
}

class ShareSheetDataSaver implements DataSaver {
  const ShareSheetDataSaver();

  @override
  Future<void> save(String fileName, String json) async {
    await SharePlus.instance.share(
      ShareParams(
        files: <XFile>[XFile.fromData(utf8.encode(json), mimeType: 'application/json', name: fileName)],
        fileNameOverrides: <String>[fileName],
        subject: 'My AMIVARA data',
      ),
    );
  }
}

/// Overridden in main.dart and in tests.
final settingsRepositoryProvider = Provider<SettingsRepository>((ref) => throw UnimplementedError('override in main'));
final dataSaverProvider = Provider<DataSaver>((ref) => const ShareSheetDataSaver());
