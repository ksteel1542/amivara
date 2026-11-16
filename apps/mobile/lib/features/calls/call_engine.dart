import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:livekit_client/livekit_client.dart' as lk;

/// The audio/video side of a call. The API decides who may call and what it
/// costs; the engine only joins the room it was given a token for. Swappable
/// so widget tests run without WebRTC.
abstract interface class CallEngine {
  /// Joins the room and publishes the microphone (and the camera for video).
  /// `publish: false` joins to listen only (a Chat House audience member).
  Future<void> connect({required String url, required String token, required bool video, bool publish = true});

  /// Starts or stops publishing (taking or leaving a Chat House seat, a Host mute).
  Future<void> setPublishing(bool on, {required bool video});
  Future<void> setMicrophone(bool on);
  Future<void> setCamera(bool on);
  Future<void> switchCamera(bool front);
  Future<void> setSpeaker(bool on);
  Future<void> disconnect();

  /// Fires when the other member left or the room closed.
  Stream<void> get ended;

  /// Repaints when tracks appear or go (video views).
  Listenable get changes;
  bool get remoteConnected;
  Widget remoteVideo();
  Widget localVideo();
}

class LiveKitCallEngine implements CallEngine {
  lk.Room? _room;
  lk.EventsListener<lk.RoomEvent>? _listener;
  final StreamController<void> _ended = StreamController<void>.broadcast();
  final ChangeNotifier _changes = ChangeNotifier();

  @override
  Stream<void> get ended => _ended.stream;

  @override
  Listenable get changes => _changes;

  void _changed() {
    // ignore: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member
    _changes.notifyListeners();
  }

  @override
  Future<void> connect({required String url, required String token, required bool video, bool publish = true}) async {
    final room = lk.Room(
      roomOptions: const lk.RoomOptions(
        adaptiveStream: true,
        dynacast: true,
        defaultCameraCaptureOptions: lk.CameraCaptureOptions(maxFrameRate: 24),
      ),
    );
    _room = room;
    _listener = room.createListener()
      ..on<lk.ParticipantDisconnectedEvent>((_) => _ended.add(null))
      ..on<lk.RoomDisconnectedEvent>((_) => _ended.add(null))
      ..on<lk.TrackSubscribedEvent>((_) => _changed())
      ..on<lk.TrackUnsubscribedEvent>((_) => _changed())
      ..on<lk.ParticipantConnectedEvent>((_) => _changed())
      ..on<lk.LocalTrackPublishedEvent>((_) => _changed());
    await room.connect(url, token);
    if (publish) {
      await room.localParticipant?.setMicrophoneEnabled(true);
      if (video) await room.localParticipant?.setCameraEnabled(true);
    }
    // Video calls and rooms default to the loudspeaker, voice calls to the earpiece.
    await setSpeaker(video || !publish);
    _changed();
  }

  @override
  Future<void> setPublishing(bool on, {required bool video}) async {
    await _room?.localParticipant?.setMicrophoneEnabled(on);
    if (video) await _room?.localParticipant?.setCameraEnabled(on);
    _changed();
  }

  @override
  Future<void> setMicrophone(bool on) async => _room?.localParticipant?.setMicrophoneEnabled(on);

  @override
  Future<void> setCamera(bool on) async {
    await _room?.localParticipant?.setCameraEnabled(on);
    _changed();
  }

  @override
  Future<void> switchCamera(bool front) async {
    final track = _localVideoTrack;
    if (track == null) return;
    await track.setCameraPosition(front ? lk.CameraPosition.front : lk.CameraPosition.back);
    _changed();
  }

  @override
  Future<void> setSpeaker(bool on) async {
    try {
      await lk.AudioManager.instance.setSpeakerOutputPreferred(on);
    } catch (_) {
      // Not every device lets apps route audio; the call continues either way.
    }
  }

  @override
  Future<void> disconnect() async {
    final room = _room;
    _room = null;
    await _listener?.dispose();
    _listener = null;
    await room?.disconnect();
    await room?.dispose();
  }

  lk.LocalVideoTrack? get _localVideoTrack {
    for (final pub in _room?.localParticipant?.videoTrackPublications ?? const <lk.LocalTrackPublication>[]) {
      final track = pub.track;
      if (track is lk.LocalVideoTrack) return track;
    }
    return null;
  }

  lk.VideoTrack? get _remoteVideoTrack {
    for (final p in _room?.remoteParticipants.values ?? const <lk.RemoteParticipant>[]) {
      for (final pub in p.videoTrackPublications) {
        final track = pub.track;
        if (pub.subscribed && track != null) return track;
      }
    }
    return null;
  }

  @override
  bool get remoteConnected => (_room?.remoteParticipants.isNotEmpty) ?? false;

  @override
  Widget remoteVideo() {
    final track = _remoteVideoTrack;
    return track == null ? const SizedBox.shrink() : lk.VideoTrackRenderer(track, fit: lk.VideoViewFit.cover);
  }

  @override
  Widget localVideo() {
    final track = _localVideoTrack;
    return track == null
        ? const SizedBox.shrink()
        : lk.VideoTrackRenderer(track, fit: lk.VideoViewFit.cover, mirrorMode: lk.VideoViewMirrorMode.mirror);
  }
}

/// A fresh engine per call. Overridden in tests.
final callEngineFactoryProvider = Provider<CallEngine Function()>((ref) => LiveKitCallEngine.new);
