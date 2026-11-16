import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../auth/auth_providers.dart';
import '../chat/chat_socket.dart';
import 'call_engine.dart';
import 'call_repository.dart';

enum CallPhase { incoming, outgoing, connecting, active, ended }

/// The member's one call at a time (MONETIZATION_PLAN.md M4/M5).
@immutable
class CallState {
  const CallState({
    required this.call,
    required this.otherName,
    required this.phase,
    this.balance,
    this.lowBalance = false,
    this.endMessage,
    this.topUpNeeded,
    this.micOn = true,
    this.cameraOn = true,
    this.speakerOn = false,
    this.frontCamera = true,
    this.connectedAt,
  });

  final CallInfo call;
  final String otherName;
  final CallPhase phase;

  /// The caller's coins (paid calls), updated after every billed minute.
  final int? balance;

  /// Less than a minute of coins left: the next minute can't be paid without a top-up.
  final bool lowBalance;
  final String? endMessage;

  /// Set when the server cut the call off for coins: open the top-up sheet for this many.
  final int? topUpNeeded;
  final bool micOn;
  final bool cameraOn;
  final bool speakerOn;
  final bool frontCamera;

  /// When this phone joined the media room (the call timer starts here).
  final DateTime? connectedAt;

  CallState copyWith({
    CallInfo? call,
    CallPhase? phase,
    int? balance,
    bool? lowBalance,
    String? endMessage,
    int? topUpNeeded,
    bool? micOn,
    bool? cameraOn,
    bool? speakerOn,
    bool? frontCamera,
    DateTime? connectedAt,
  }) => CallState(
    call: call ?? this.call,
    otherName: otherName,
    phase: phase ?? this.phase,
    balance: balance ?? this.balance,
    lowBalance: lowBalance ?? this.lowBalance,
    endMessage: endMessage ?? this.endMessage,
    topUpNeeded: topUpNeeded ?? this.topUpNeeded,
    micOn: micOn ?? this.micOn,
    cameraOn: cameraOn ?? this.cameraOn,
    speakerOn: speakerOn ?? this.speakerOn,
    frontCamera: frontCamera ?? this.frontCamera,
    connectedAt: connectedAt ?? this.connectedAt,
  );
}

/// Opens the app-wide signalling socket (/ws/chat). main.dart uses the real socket;
/// by default (tests) nothing connects.
final callSocketFactoryProvider = Provider<ChatSocket Function()>((ref) => _SilentSocket.new);

class _SilentSocket implements ChatSocket {
  @override
  Stream<ChatEvent> get events => const Stream<ChatEvent>.empty();
  @override
  bool get connected => false;
  @override
  Future<void> connect(String accessToken) async {}
  @override
  void emit(String event, Map<String, dynamic> data) {}
  @override
  Future<void> close() async {}
}

/// Rings, answers and hangs up through the API, follows the server's call
/// events (call:ring, call:accept, call:decline, call:end, call:billed,
/// call:low_balance), and drives the media engine. Billing is the server's:
/// the app only shows it.
class CallController extends Notifier<CallState?> {
  ChatSocket? _socket;
  StreamSubscription<ChatEvent>? _events;
  CallEngine? _engine;
  StreamSubscription<void>? _engineEnded;

  @override
  CallState? build() {
    ref.onDispose(() {
      unawaited(_events?.cancel());
      unawaited(_socket?.close());
      unawaited(_dropMedia());
    });
    return null;
  }

  CallRepository get _repo => ref.read(callRepositoryProvider);
  String? get _token => ref.read(sessionProvider)?.accessToken;

  /// The engine of the current call (video views, while connected).
  CallEngine? get engine => _engine;

  /// Signed in: listen for calls. Picks up a call that rang while the app was closed.
  Future<void> attach() async {
    final token = _token;
    if (token == null || _socket != null) return;
    final socket = ref.read(callSocketFactoryProvider)();
    _socket = socket;
    _events = socket.events.listen(onEvent);
    await socket.connect(token);
    try {
      final current = await _repo.current(token);
      if (current == null || state != null) return;
      final call = current.call;
      if (call.status == 'ringing' && !call.isCaller) {
        state = CallState(call: call, otherName: current.otherName, phase: CallPhase.incoming);
      } else {
        // A call this phone dropped out of (the app was closed): stop it, and its billing.
        await _repo.end(token, call.id);
      }
    } on Object {
      // Calls just won't show until the next event.
    }
  }

  /// Signed out: hang up and stop listening.
  Future<void> detach() async {
    if (state?.call.live ?? false) await hangUp();
    await _events?.cancel();
    _events = null;
    await _socket?.close();
    _socket = null;
    state = null;
  }

  /// Rings [matchId]. Throws ApiException (402 INSUFFICIENT_COINS, 409 CALLEE_BUSY…) for the chat to show.
  Future<void> startCall({required String matchId, required String otherName, required CallType type}) async {
    if (state != null && state!.phase != CallPhase.ended) return;
    final call = await _repo.start(_token!, matchId, type);
    state = CallState(call: call, otherName: otherName, phase: CallPhase.outgoing, speakerOn: call.video);
  }

  Future<void> accept() async {
    final current = state;
    if (current == null || current.phase != CallPhase.incoming) return;
    state = current.copyWith(phase: CallPhase.connecting);
    try {
      final answered = await _repo.accept(_token!, current.call.id);
      state = state!.copyWith(call: answered.call, speakerOn: answered.call.video);
      await _connect(answered.media);
    } on ApiException catch (e) {
      _finish(current.call, message: e.statusCode == 409 ? 'This call has ended.' : e.message);
    } on Object {
      await hangUp(message: "The call couldn't connect.");
    }
  }

  Future<void> decline() async {
    final current = state;
    if (current == null) return;
    _finish(current.call, message: 'Call declined');
    try {
      await _repo.decline(_token!, current.call.id);
    } on Object {
      // The ring times out on its own.
    }
  }

  /// Hangs up (or cancels a ringing call). The server stops billing at once.
  Future<void> hangUp({String? message}) async {
    final current = state;
    if (current == null) return;
    _finish(current.call, message: message ?? 'Call ended');
    try {
      final ended = await _repo.end(_token!, current.call.id);
      if (state?.call.id == ended.id) state = state!.copyWith(call: ended);
    } on Object {
      // The server also ends calls whose member left the room or went offline.
    }
  }

  /// Closes the ended-call screen.
  void dismiss() {
    if (state?.phase == CallPhase.ended) state = null;
  }

  Future<void> toggleMic() async {
    final s = state;
    if (s == null) return;
    state = s.copyWith(micOn: !s.micOn);
    await _engine?.setMicrophone(!s.micOn);
  }

  Future<void> toggleCamera() async {
    final s = state;
    if (s == null) return;
    state = s.copyWith(cameraOn: !s.cameraOn);
    await _engine?.setCamera(!s.cameraOn);
  }

  Future<void> flipCamera() async {
    final s = state;
    if (s == null) return;
    state = s.copyWith(frontCamera: !s.frontCamera);
    await _engine?.switchCamera(!s.frontCamera);
  }

  Future<void> toggleSpeaker() async {
    final s = state;
    if (s == null) return;
    state = s.copyWith(speakerOn: !s.speakerOn);
    await _engine?.setSpeaker(!s.speakerOn);
  }

  /// Server events from /ws/chat.
  @visibleForTesting
  void onEvent(ChatEvent e) {
    if (!e.event.startsWith('call:')) return;
    final callJson = e.data['call'] as Map<String, dynamic>?;
    final call = callJson == null ? null : CallInfo.fromJson(callJson);
    final current = state;
    final sameCall = current != null && (call?.id ?? e.data['call_id']) == current.call.id;
    switch (e.event) {
      case 'call:ring':
        if (call == null || (current != null && current.phase != CallPhase.ended)) return;
        final caller = e.data['caller'] as Map<String, dynamic>?;
        state = CallState(call: call, otherName: caller?['first_name'] as String? ?? '', phase: CallPhase.incoming);
      case 'call:accept':
        if (!sameCall || call == null) return;
        if (call.isCaller && current.phase == CallPhase.outgoing) {
          state = current.copyWith(call: call, phase: CallPhase.connecting);
          unawaited(_join());
        } else if (!call.isCaller && current.phase == CallPhase.incoming) {
          state = null; // answered on another of this member's devices
        }
      case 'call:decline' || 'call:end':
        if (!sameCall || call == null || current.phase == CallPhase.ended) return;
        final topUp = e.data['top_up'] as Map<String, dynamic>?;
        final needed = topUp == null
            ? null
            : ((topUp['required'] as num?)?.toInt() ?? 0) - ((topUp['balance'] as num?)?.toInt() ?? 0);
        _finish(call, message: _endMessage(call), topUpNeeded: needed, balance: (topUp?['balance'] as num?)?.toInt());
      case 'call:billed':
        if (!sameCall) return;
        final balance = (e.data['balance'] as num?)?.toInt();
        state = current.copyWith(
          balance: balance,
          lowBalance: balance != null && balance < current.call.ratePerMinute,
          call: CallInfo(
            id: current.call.id,
            matchId: current.call.matchId,
            type: current.call.type,
            status: current.call.status,
            isCaller: current.call.isCaller,
            otherUserId: current.call.otherUserId,
            ratePerMinute: current.call.ratePerMinute,
            startedAt: current.call.startedAt,
            billedMinutes: (e.data['billed_minutes'] as num?)?.toInt() ?? current.call.billedMinutes,
            totalCoinsBilled: (e.data['total_coins_billed'] as num?)?.toInt(),
          ),
        );
      case 'call:low_balance':
        if (!sameCall) return;
        state = current.copyWith(lowBalance: true, balance: (e.data['balance'] as num?)?.toInt());
    }
  }

  /// After a top-up during the call: the warning goes once a minute is covered again.
  void balanceToppedUp(int balance) {
    final s = state;
    if (s == null) return;
    state = s.copyWith(balance: balance, lowBalance: balance < s.call.ratePerMinute);
  }

  String _endMessage(CallInfo call) => switch (call.status) {
    'declined' => call.isCaller ? '${state?.otherName ?? 'They'} declined the call' : 'Call declined',
    'missed' => call.isCaller ? 'No answer' : 'Missed call',
    'cancelled' => 'Call cancelled',
    'insufficient_coins' => call.isCaller ? 'Call ended: you ran out of coins' : 'Call ended',
    _ => 'Call ended',
  };

  Future<void> _join() async {
    try {
      final joined = await _repo.join(_token!, state!.call.id);
      if (state == null || state!.phase == CallPhase.ended) return;
      state = state!.copyWith(call: joined.call, balance: joined.balance);
      await _connect(joined.media);
    } on Object {
      await hangUp(message: "The call couldn't connect.");
    }
  }

  Future<void> _connect(CallMedia media) async {
    final engine = ref.read(callEngineFactoryProvider)();
    _engine = engine;
    _engineEnded = engine.ended.listen((_) {
      if (state?.phase == CallPhase.active) unawaited(hangUp());
    });
    await engine.connect(url: media.url, token: media.token, video: state!.call.video);
    if (state == null || state!.phase == CallPhase.ended) {
      await _dropMedia();
      return;
    }
    state = state!.copyWith(phase: CallPhase.active, connectedAt: DateTime.now());
  }

  void _finish(CallInfo call, {required String message, int? topUpNeeded, int? balance}) {
    final s = state;
    if (s == null) return;
    state = CallState(
      call: call,
      otherName: s.otherName,
      phase: CallPhase.ended,
      balance: balance ?? s.balance,
      endMessage: message,
      topUpNeeded: topUpNeeded,
      connectedAt: s.connectedAt,
    );
    unawaited(_dropMedia());
  }

  Future<void> _dropMedia() async {
    // Leave the room first, right away: the microphone and camera stop with it.
    final engine = _engine;
    _engine = null;
    final subscription = _engineEnded;
    _engineEnded = null;
    final left = engine?.disconnect();
    await subscription?.cancel();
    await left;
  }
}

final callControllerProvider = NotifierProvider<CallController, CallState?>(CallController.new);
