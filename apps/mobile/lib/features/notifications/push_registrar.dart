import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

/// Build-time Firebase settings (no google-services.json is committed):
/// `--dart-define=FIREBASE_API_KEY=... --dart-define=FIREBASE_APP_ID=...`
/// `--dart-define=FIREBASE_SENDER_ID=... --dart-define=FIREBASE_PROJECT_ID=...`
abstract final class FirebaseConfig {
  static const String apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const String appId = String.fromEnvironment('FIREBASE_APP_ID');
  static const String senderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const String projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');

  static bool get present => apiKey.isNotEmpty && appId.isNotEmpty && senderId.isNotEmpty && projectId.isNotEmpty;
}

/// Gets the device's FCM token (asking for notification permission once) and
/// reports pushes the app should react to (e.g. "match.removed" refreshes the list).
abstract interface class PushRegistrar {
  /// Calls [onToken] with the current token, and again whenever FCM rotates it.
  Future<void> start(Future<void> Function(String token) onToken);

  /// `data.type` of pushes received while the app is open.
  Stream<String> get events;

  Future<void> stop();
}

class FcmPushRegistrar implements PushRegistrar {
  StreamSubscription<String>? _refresh;
  StreamSubscription<RemoteMessage>? _messages;
  final StreamController<String> _events = StreamController<String>.broadcast();

  @override
  Stream<String> get events => _events.stream;

  @override
  Future<void> start(Future<void> Function(String token) onToken) async {
    if (!FirebaseConfig.present) return; // this build has no Firebase project: push is off
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(
          options: const FirebaseOptions(
            apiKey: FirebaseConfig.apiKey,
            appId: FirebaseConfig.appId,
            messagingSenderId: FirebaseConfig.senderId,
            projectId: FirebaseConfig.projectId,
          ),
        );
      }
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;

      // getToken/onTokenRefresh return classic FCM registration tokens, which the API's
      // FCM HTTP v1 sender targets. Moving to register()/onRegistered (Firebase Installation
      // IDs) is a follow-up once the server side is confirmed against it.
      // ignore: deprecated_member_use
      final token = await messaging.getToken();
      if (token != null) await onToken(token);
      await _refresh?.cancel();
      // ignore: deprecated_member_use
      _refresh = messaging.onTokenRefresh.listen((t) => onToken(t));
      await _messages?.cancel();
      _messages = FirebaseMessaging.onMessage.listen((m) {
        final type = m.data['type'];
        if (type is String) _events.add(type);
      });
    } on Object {
      // Never let push setup break sign-in.
    }
  }

  @override
  Future<void> stop() async {
    await _refresh?.cancel();
    await _messages?.cancel();
    _refresh = null;
    _messages = null;
  }
}
