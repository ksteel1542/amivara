import 'package:audioplayers/audioplayers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The incoming-call ringtone. Loops while a call rings; stops when it's
/// answered, declined, cancelled or times out.
abstract interface class Ringtone {
  Future<void> start();
  Future<void> stop();
}

/// AMIVARA's own chime (assets/sounds/amivara_ringtone.mp3, made by
/// scripts/sounds/make_ringtone.py), played on Android's ringtone stream so it
/// follows the phone's ringer volume and silent mode.
class AssetRingtone implements Ringtone {
  AudioPlayer? _player;
  bool _ringing = false;

  @override
  Future<void> start() async {
    if (_ringing) return;
    _ringing = true;
    final player = _player ??= AudioPlayer(playerId: 'amivara-ringtone');
    try {
      await player.setAudioContext(
        AudioContext(
          android: const AudioContextAndroid(
            usageType: AndroidUsageType.notificationRingtone,
            contentType: AndroidContentType.sonification,
            audioFocus: AndroidAudioFocus.gainTransient,
          ),
        ),
      );
      await player.setReleaseMode(ReleaseMode.loop);
      if (_ringing) await player.play(AssetSource('sounds/amivara_ringtone.mp3'));
    } catch (_) {
      // No ringtone is better than no call: the screen still shows it.
    }
  }

  @override
  Future<void> stop() async {
    _ringing = false;
    try {
      await _player?.stop();
    } catch (_) {}
  }
}

class _SilentRingtone implements Ringtone {
  @override
  Future<void> start() async {}

  @override
  Future<void> stop() async {}
}

/// main.dart plays [AssetRingtone]; by default (tests) nothing plays.
final ringtoneProvider = Provider<Ringtone>((ref) => _SilentRingtone());
