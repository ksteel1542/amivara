import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../../core/config.dart';

/// A server → client event on /ws/chat: message.new, message.read, typing,
/// photos.unlocked, match.removed or error.
class ChatEvent {
  const ChatEvent(this.event, this.data);

  final String event;
  final Map<String, dynamic> data;

  String? get matchId => data['match_id'] as String?;
}

/// The live chat connection. One per open chat screen.
abstract interface class ChatSocket {
  Stream<ChatEvent> get events;

  /// True while connected; sends fall back to REST otherwise.
  bool get connected;

  Future<void> connect(String accessToken);
  void emit(String event, Map<String, dynamic> data);
  Future<void> close();
}

/// dart:io WebSocket (Android) with the access token in the Authorization
/// header, a ping keep-alive and reconnect with backoff. Close codes 4401 /
/// 4403 (session ended, not allowed) stop reconnecting.
class IoChatSocket implements ChatSocket {
  IoChatSocket({String? url}) : _url = url ?? chatSocketUrl(AppConfig.apiBaseUrl);

  final String _url;
  final StreamController<ChatEvent> _events = StreamController<ChatEvent>.broadcast();
  WebSocket? _ws;
  String? _token;
  bool _closed = false;
  int _attempt = 0;
  Timer? _retry;

  /// https://api.amivara.com/v1 → wss://api.amivara.com/ws/chat
  static String chatSocketUrl(String apiBaseUrl) {
    final api = Uri.parse(apiBaseUrl);
    return api.replace(scheme: api.scheme == 'https' ? 'wss' : 'ws', path: '/ws/chat').toString();
  }

  @override
  Stream<ChatEvent> get events => _events.stream;

  @override
  bool get connected => _ws?.readyState == WebSocket.open;

  @override
  Future<void> connect(String accessToken) async {
    _token = accessToken;
    _closed = false;
    await _open();
  }

  Future<void> _open() async {
    if (_closed || _token == null) return;
    try {
      final ws = await WebSocket.connect(_url, headers: <String, dynamic>{'Authorization': 'Bearer $_token'});
      ws.pingInterval = const Duration(seconds: 25);
      _ws = ws;
      _attempt = 0;
      ws.listen(
        (raw) {
          try {
            final json = jsonDecode(raw as String) as Map<String, dynamic>;
            _events.add(ChatEvent(json['event'] as String, (json['data'] as Map<String, dynamic>?) ?? {}));
          } catch (_) {
            // Ignore frames this version doesn't understand.
          }
        },
        onDone: () {
          final code = ws.closeCode;
          if (code == 4401 || code == 4403) _closed = true;
          _scheduleReconnect();
        },
        onError: (_) => _scheduleReconnect(),
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    _ws = null;
    if (_closed) return;
    _retry?.cancel();
    final seconds = [1, 2, 5, 10, 30][_attempt.clamp(0, 4)];
    _attempt++;
    _retry = Timer(Duration(seconds: seconds), _open);
  }

  @override
  void emit(String event, Map<String, dynamic> data) {
    if (connected) _ws!.add(jsonEncode(<String, dynamic>{'event': event, 'data': data}));
  }

  @override
  Future<void> close() async {
    _closed = true;
    _retry?.cancel();
    await _ws?.close();
    _ws = null;
    await _events.close();
  }
}
