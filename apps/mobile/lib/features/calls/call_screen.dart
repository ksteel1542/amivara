import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../safety/report_user_sheet.dart';
import '../wallet/topup_sheet.dart';
import 'call_controller.dart';
import 'call_repository.dart';

const Color _callBackground = Color(0xFF1B1416);
const Color _declineRed = Color(0xFFD64545);
const Color _acceptGreen = Color(0xFF2E9E5B);

/// Incoming, ringing, active and ended calls, full screen (route /call).
/// Shown by the app whenever a call starts or rings; closes itself after.
class CallScreen extends ConsumerStatefulWidget {
  const CallScreen({super.key});

  @override
  ConsumerState<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends ConsumerState<CallScreen> {
  Timer? _clock;
  Timer? _autoClose;
  bool _topUpShown = false;
  bool _closing = false;

  CallController get _calls => ref.read(callControllerProvider.notifier);

  @override
  void initState() {
    super.initState();
    _clock = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && ref.read(callControllerProvider)?.phase == CallPhase.active) setState(() {});
    });
  }

  @override
  void dispose() {
    _clock?.cancel();
    _autoClose?.cancel();
    super.dispose();
  }

  void _close() {
    if (_closing) return;
    _closing = true;
    _calls.dismiss();
    if (mounted && context.canPop()) context.pop();
  }

  Future<void> _topUp(int needed) async {
    final result = await showTopUpSheet(context, needed: needed);
    if (result != null) _calls.balanceToppedUp(result.balance);
  }

  Future<void> _onEnded(CallState s) async {
    if (s.topUpNeeded != null && s.topUpNeeded! > 0 && !_topUpShown) {
      _topUpShown = true;
      await showTopUpSheet(context, needed: s.topUpNeeded);
      _close();
      return;
    }
    _autoClose ??= Timer(const Duration(seconds: 2), _close);
  }

  Future<void> _safety(CallState s) async {
    final outcome = await showSafetyMenu(context, userId: s.call.otherUserId, firstName: s.otherName);
    if (outcome != null) await _calls.hangUp();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(callControllerProvider);
    ref.listen<CallState?>(callControllerProvider, (prev, next) {
      if (next == null) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _close());
      } else if (next.phase == CallPhase.ended && prev?.phase != CallPhase.ended) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _onEnded(next));
      }
    });
    if (s == null) return const Scaffold(backgroundColor: _callBackground);

    final engine = _calls.engine;
    final showVideo = s.call.video && s.phase == CallPhase.active && engine != null;
    return PopScope(
      canPop: s.phase == CallPhase.ended,
      child: Scaffold(
        key: const Key('call-screen'),
        backgroundColor: _callBackground,
        body: Stack(
          fit: StackFit.expand,
          children: <Widget>[
            if (showVideo)
              ListenableBuilder(
                listenable: engine.changes,
                builder: (_, _) => Positioned.fill(child: engine.remoteVideo()),
              ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
                child: Column(
                  children: <Widget>[
                    _Header(state: s, showAvatar: !showVideo),
                    if (s.lowBalance && s.call.youPay && s.phase == CallPhase.active)
                      _LowBalanceBanner(
                        onTopUp: () => _topUp(s.call.ratePerMinute - (s.balance ?? 0)),
                        rate: s.call.ratePerMinute,
                      ),
                    const Spacer(),
                    _Controls(
                      state: s,
                      onAccept: _calls.accept,
                      onDecline: _calls.decline,
                      onEnd: () => _calls.hangUp(),
                      onMic: _calls.toggleMic,
                      onSpeaker: _calls.toggleSpeaker,
                      onCamera: _calls.toggleCamera,
                      onFlip: _calls.flipCamera,
                      onSafety: () => _safety(s),
                      onClose: _close,
                    ),
                  ],
                ),
              ),
            ),
            if (showVideo && s.cameraOn)
              Positioned(
                right: 16,
                bottom: 140,
                width: 104,
                height: 148,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: ListenableBuilder(listenable: engine.changes, builder: (_, _) => engine.localVideo()),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.state, required this.showAvatar});

  final CallState state;
  final bool showAvatar;

  String get _status => switch (state.phase) {
    CallPhase.incoming when state.call.invite => 'invites you to a live ${state.call.video ? 'video' : 'voice'} call',
    CallPhase.incoming => 'Incoming ${state.call.video ? 'video' : 'voice'} call',
    CallPhase.outgoing => 'Calling…',
    CallPhase.connecting => 'Connecting…',
    CallPhase.active => _elapsed(),
    CallPhase.ended => state.endMessage ?? 'Call ended',
  };

  /// The free preview counting down.
  String _previewLeft() {
    final from = state.connectedAt ?? state.call.startedAt ?? DateTime.now();
    final left = (state.call.previewSeconds - DateTime.now().difference(from).inSeconds).clamp(0, 60);
    return 'Free preview · 0:${left.toString().padLeft(2, '0')}';
  }

  String _elapsed() {
    final from = state.connectedAt ?? state.call.startedAt;
    if (from == null) return '0:00';
    final d = DateTime.now().difference(from);
    final m = d.inMinutes;
    final sec = (d.inSeconds % 60).toString().padLeft(2, '0');
    return d.inHours > 0 ? '${d.inHours}:${(m % 60).toString().padLeft(2, '0')}:$sec' : '$m:$sec';
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final name = state.otherName.isEmpty ? 'Your match' : state.otherName;
    final call = state.call;
    return Column(
      children: <Widget>[
        if (showAvatar) ...<Widget>[
          const SizedBox(height: 32),
          CircleAvatar(
            radius: 48,
            backgroundColor: Colors.white24,
            child: Text(name.characters.first.toUpperCase(), style: text.headlineLarge?.copyWith(color: Colors.white)),
          ),
          const SizedBox(height: 16),
        ],
        Text(
          name,
          key: const Key('call-name'),
          style: text.headlineSmall?.copyWith(color: Colors.white),
        ),
        const SizedBox(height: 6),
        Text(
          _status,
          key: Key(state.phase == CallPhase.active ? 'call-timer' : 'call-status'),
          style: text.bodyLarge?.copyWith(color: Colors.white70),
        ),
        if (call.paid) ...<Widget>[
          const SizedBox(height: 12),
          _Pill(
            key: const Key('call-coins'),
            icon: Icons.toll_outlined,
            text: !call.youPay
                ? 'Paid call · ${call.ratePerMinute} coins/min'
                : state.phase == CallPhase.incoming
                // Before answering, the member sees exactly what it costs them.
                ? (call.previewSeconds > 0
                      ? 'First ${call.previewSeconds} s free, then ${call.ratePerMinute} coins/min'
                      : 'You pay ${call.ratePerMinute} coins/min')
                : [if (state.balance != null) '${state.balance} coins', '${call.ratePerMinute} coins/min'].join(' · '),
          ),
          if (call.youPay && state.phase == CallPhase.active && call.previewSeconds > 0 && call.billedMinutes == 0)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: _Pill(key: const Key('call-preview'), icon: Icons.card_giftcard, text: _previewLeft()),
            ),
        ],
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({super.key, required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
    decoration: BoxDecoration(color: Colors.white12, borderRadius: BorderRadius.circular(999)),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: 16, color: Colors.white),
        const SizedBox(width: 6),
        Flexible(
          child: Text(text, style: const TextStyle(color: Colors.white)),
        ),
      ],
    ),
  );
}

class _LowBalanceBanner extends StatelessWidget {
  const _LowBalanceBanner({required this.onTopUp, required this.rate});

  final VoidCallback onTopUp;
  final int rate;

  @override
  Widget build(BuildContext context) => Container(
    key: const Key('call-low-balance'),
    margin: const EdgeInsets.only(top: 16),
    padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
    decoration: BoxDecoration(color: const Color(0xFFB7791F), borderRadius: BorderRadius.circular(12)),
    child: Row(
      children: <Widget>[
        Expanded(
          child: Text(
            'Less than a minute of coins left. Top up to keep talking ($rate coins/min).',
            style: const TextStyle(color: Colors.white),
          ),
        ),
        TextButton(
          key: const Key('call-topup'),
          onPressed: onTopUp,
          style: TextButton.styleFrom(foregroundColor: Colors.white),
          child: const Text('Top up'),
        ),
      ],
    ),
  );
}

class _Controls extends StatelessWidget {
  const _Controls({
    required this.state,
    required this.onAccept,
    required this.onDecline,
    required this.onEnd,
    required this.onMic,
    required this.onSpeaker,
    required this.onCamera,
    required this.onFlip,
    required this.onSafety,
    required this.onClose,
  });

  final CallState state;
  final VoidCallback onAccept, onDecline, onEnd, onMic, onSpeaker, onCamera, onFlip, onSafety, onClose;

  @override
  Widget build(BuildContext context) {
    switch (state.phase) {
      case CallPhase.incoming:
        return Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: <Widget>[
            _RoundButton(
              key: const Key('call-decline'),
              icon: Icons.call_end,
              label: 'Decline',
              color: _declineRed,
              onTap: onDecline,
            ),
            _RoundButton(
              key: const Key('call-accept'),
              icon: state.call.video ? Icons.videocam : Icons.call,
              label: 'Accept',
              color: _acceptGreen,
              onTap: onAccept,
            ),
          ],
        );
      case CallPhase.ended:
        return _RoundButton(
          key: const Key('call-close'),
          icon: Icons.close,
          label: 'Close',
          color: Colors.white24,
          onTap: onClose,
        );
      case CallPhase.outgoing || CallPhase.connecting || CallPhase.active:
        final active = state.phase == CallPhase.active;
        return Column(
          children: <Widget>[
            if (active)
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 12,
                runSpacing: 12,
                children: <Widget>[
                  _RoundButton(
                    key: const Key('call-mic'),
                    icon: state.micOn ? Icons.mic : Icons.mic_off,
                    label: state.micOn ? 'Mute' : 'Unmute',
                    selected: !state.micOn,
                    onTap: onMic,
                  ),
                  _RoundButton(
                    key: const Key('call-speaker'),
                    icon: state.speakerOn ? Icons.volume_up : Icons.hearing,
                    label: state.speakerOn ? 'Speaker' : 'Earpiece',
                    selected: state.speakerOn,
                    onTap: onSpeaker,
                  ),
                  if (state.call.video) ...<Widget>[
                    _RoundButton(
                      key: const Key('call-camera'),
                      icon: state.cameraOn ? Icons.videocam : Icons.videocam_off,
                      label: state.cameraOn ? 'Camera' : 'Camera off',
                      selected: !state.cameraOn,
                      onTap: onCamera,
                    ),
                    _RoundButton(key: const Key('call-flip'), icon: Icons.cameraswitch, label: 'Flip', onTap: onFlip),
                  ],
                  _RoundButton(
                    key: const Key('call-safety'),
                    icon: Icons.shield_outlined,
                    label: 'Safety',
                    onTap: onSafety,
                  ),
                ],
              ),
            const SizedBox(height: 24),
            _RoundButton(
              key: const Key('call-end'),
              icon: Icons.call_end,
              label: active ? 'End' : 'Cancel',
              color: _declineRed,
              onTap: onEnd,
            ),
          ],
        );
    }
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.color,
    this.selected = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final bg = color ?? (selected ? Colors.white : Colors.white24);
    final fg = color == null && selected ? _callBackground : Colors.white;
    return Semantics(
      button: true,
      label: label,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Material(
            color: bg,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onTap,
              child: SizedBox(width: 64, height: 64, child: Icon(icon, color: fg, size: 28)),
            ),
          ),
          const SizedBox(height: 6),
          ExcludeSemantics(
            child: Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
          ),
        ],
      ),
    );
  }
}

/// The voice and video buttons in a chat's app bar, with the price as a tooltip.
class CallButtons extends StatelessWidget {
  const CallButtons({super.key, required this.quote, required this.onCall});

  final CallQuote quote;
  final void Function(CallType type) onCall;

  String _tip(CallType type) {
    final what = type == CallType.video ? 'Video call' : 'Voice call';
    final rate = quote.rateFor(type);
    if (rate == 0) return '$what · free';
    if (quote.freePreviewSeconds > 0) return '$what · first ${quote.freePreviewSeconds} s free, then $rate coins/min';
    return '$what · $rate coins/min';
  }

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: <Widget>[
      IconButton(
        key: const Key('chat-voice-call'),
        tooltip: _tip(CallType.voice),
        icon: const Icon(Icons.call_outlined),
        onPressed: () => onCall(CallType.voice),
      ),
      IconButton(
        key: const Key('chat-video-call'),
        tooltip: _tip(CallType.video),
        icon: const Icon(Icons.videocam_outlined),
        onPressed: () => onCall(CallType.video),
      ),
    ],
  );
}
