import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/api_client.dart';
import 'package:amivara/core/secure_store.dart';
import 'package:amivara/features/auth/auth_providers.dart';
import 'package:amivara/features/auth/auth_repository.dart';
import 'package:amivara/features/chat/chat_repository.dart';
import 'package:amivara/features/chat/chat_socket.dart';
import 'package:amivara/features/discovery/discovery_models.dart';
import 'package:amivara/features/discovery/discovery_providers.dart';
import 'package:amivara/features/discovery/discovery_repository.dart';
import 'package:amivara/features/home/home_screen.dart';
import 'package:amivara/features/matches/matches_repository.dart';
import 'package:amivara/features/notifications/push_registrar.dart';
import 'package:amivara/features/profile/photo_processor.dart';
import 'package:amivara/features/profile/profile_models.dart';
import 'package:amivara/features/profile/profile_providers.dart';
import 'package:amivara/features/profile/profile_repository.dart';
import 'package:amivara/features/safety/safety_repository.dart';
import 'package:amivara/features/verification/identity_capture.dart';
import 'package:amivara/features/verification/verification_providers.dart';
import 'package:amivara/features/verification/verification_repository.dart';
import 'package:amivara/main.dart';

/// Scriptable AuthRepository: each call records its arguments and returns
/// (or throws) whatever the test queued.
class FakeAuthRepository implements AuthRepository {
  final List<String> calls = <String>[];
  final List<Object> _results = <Object>[];

  String? lastPhone;
  OtpChannel? lastChannel;
  String? lastCode;
  String? lastDateOfBirth;
  OnboardingDetails? lastDetails;

  /// Queue a value to return or an [ApiException] to throw, in call order.
  void then(Object result) => _results.add(result);

  T _next<T>() {
    if (_results.isEmpty) throw StateError('FakeAuthRepository: no result queued (calls: $calls)');
    final r = _results.removeAt(0);
    if (r is Exception) throw r;
    return r as T;
  }

  @override
  Future<OtpChallenge> requestOtp(String phoneE164, OtpChannel channel) async {
    calls.add('requestOtp');
    lastPhone = phoneE164;
    lastChannel = channel;
    return _next<OtpChallenge>();
  }

  @override
  Future<VerifyResult> verifyOtp(String challengeId, String code) async {
    calls.add('verifyOtp');
    lastCode = code;
    return _next<VerifyResult>();
  }

  @override
  Future<void> ageGate(String signupToken, String dateOfBirth) async {
    calls.add('ageGate');
    lastDateOfBirth = dateOfBirth;
    _next<Object>();
  }

  @override
  Future<TokenPair> completeOnboarding(String signupToken, OnboardingDetails details) async {
    calls.add('completeOnboarding');
    lastDetails = details;
    return _next<TokenPair>();
  }

  @override
  Future<TokenPair> refresh(String refreshToken) async {
    calls.add('refresh');
    return _next<TokenPair>();
  }

  /// What GET /me reports.
  bool verified = false;

  @override
  Future<MemberSummary> me(String accessToken) async {
    calls.add('me');
    return MemberSummary(firstName: 'Adaeze', ageVerified: verified);
  }
}

const OtpChallenge kChallenge = OtpChallenge(challengeId: 'c-1', channel: OtpChannel.sms, expiresIn: 300, resendIn: 60);
const TokenPair kTokens = TokenPair(accessToken: 'access', refreshToken: 'refresh-token', expiresIn: 900);

/// Ok marker for void calls (ageGate).
const Object ok = 'ok';

ApiException apiError(int status, String code, [Map<String, dynamic> details = const <String, dynamic>{}]) =>
    ApiException(status, code, code, details);

/// Pumps the real app (router + theme) at the 360 x 800dp reference frame.
Future<void> pumpApp(
  WidgetTester tester, {
  required FakeAuthRepository repo,
  FakeProfileRepository? profiles,
  FakeDiscoveryRepository? discovery,
  FakeSafetyRepository? safety,
  MemoryStore? store,
  String initialLocation = '/',
  List<dynamic> extraOverrides = const <dynamic>[],
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authRepositoryProvider.overrideWithValue(repo),
        secureStoreProvider.overrideWithValue(store ?? MemoryStore()),
        profileRepositoryProvider.overrideWithValue(profiles ?? FakeProfileRepository()),
        photoProcessorProvider.overrideWithValue(FakePhotoProcessor()),
        verificationRepositoryProvider.overrideWithValue(FakeVerificationRepository()),
        identityCaptureProvider.overrideWithValue(FakeIdentityCapture()),
        discoveryRepositoryProvider.overrideWithValue(discovery ?? FakeDiscoveryRepository()),
        locationSourceProvider.overrideWithValue(FakeLocationSource()),
        cardImageBuilderProvider.overrideWithValue(placeholderImage),
        safetyRepositoryProvider.overrideWithValue(safety ?? FakeSafetyRepository()),
        ...extraOverrides.cast(),
      ],
      child: AmivaraApp(initialLocation: initialLocation),
    ),
  );
  await tester.pumpAndSettle();
}

const ProfileCatalog kCatalog = ProfileCatalog(
  prompts: <PromptOption>[
    PromptOption('perfect_sunday', 'My perfect Sunday looks like…'),
    PromptOption('green_flag', 'The green flag I look for…'),
  ],
  maxPrompts: 5,
  maxBio: 500,
  maxPhotos: 6,
  minPhotos: 2,
);

ProfilePhoto photo(String id, {bool primary = false}) =>
    ProfilePhoto(id: id, url: 'https://media.example.test/$id', isPrimary: primary);

/// In-memory profile backend that mirrors the API's photo rules.
class FakeProfileRepository implements ProfileRepository {
  FakeProfileRepository({List<String> photoIds = const <String>[]}) {
    _ids.addAll(photoIds);
  }

  final List<String> _ids = <String>[];
  final List<String> calls = <String>[];
  String? savedBio;
  DatingIntent? savedIntent;
  List<PromptAnswer>? savedPrompts;
  int _next = 0;

  List<ProfilePhoto> get _photos => <ProfilePhoto>[
    for (var i = 0; i < _ids.length; i++) photo(_ids[i], primary: i == 0),
  ];

  @override
  Future<ProfileCatalog> catalog(String accessToken) async => kCatalog;

  @override
  Future<MyProfile> myProfile(String accessToken) async => MyProfile(
    firstName: 'Adaeze',
    bio: savedBio,
    intent: savedIntent ?? DatingIntent.relationship,
    prompts: savedPrompts ?? const <PromptAnswer>[],
    photos: _photos,
  );

  @override
  Future<MyProfile> updateProfile(
    String accessToken, {
    String? bio,
    DatingIntent? intent,
    List<PromptAnswer>? prompts,
  }) async {
    calls.add('updateProfile');
    savedBio = bio;
    savedIntent = intent;
    savedPrompts = prompts;
    return myProfile(accessToken);
  }

  @override
  Future<List<ProfilePhoto>> uploadPhoto(String accessToken, Uint8List jpegBytes) async {
    calls.add('uploadPhoto:${jpegBytes.length}');
    _ids.add('new-${_next++}');
    return _photos;
  }

  @override
  Future<List<ProfilePhoto>> reorderPhotos(String accessToken, List<String> photoIds) async {
    calls.add('reorder:${photoIds.join(',')}');
    _ids
      ..clear()
      ..addAll(photoIds);
    return _photos;
  }

  @override
  Future<List<ProfilePhoto>> makePrimary(String accessToken, String photoId) async {
    calls.add('primary:$photoId');
    _ids
      ..remove(photoId)
      ..insert(0, photoId);
    return _photos;
  }

  @override
  Future<List<ProfilePhoto>> deletePhoto(String accessToken, String photoId) async {
    calls.add('delete:$photoId');
    _ids.remove(photoId);
    return _photos;
  }
}

/// Returns a small fake "compressed JPEG" instead of opening the gallery.
class FakePhotoProcessor implements PhotoProcessor {
  @override
  Future<Uint8List?> pickAndCompress() async => Uint8List.fromList(List<int>.filled(1024, 7));
}

const VerificationTicket kTicket = VerificationTicket(
  verificationId: 'v-1',
  userId: 'u-1',
  jobId: 'job-1',
  jobType: 1,
  callbackUrl: 'https://api.example.test/v1/verification/webhook',
  sandbox: true,
  attemptsLeft: 3,
);

VerificationStatus vStatus(VerificationOutcome outcome, {int attemptsLeft = 3, bool verified = false}) =>
    VerificationStatus(ageVerified: verified, outcome: outcome, attemptsLeft: attemptsLeft);

/// Returns queued statuses in order (the last one repeats).
class FakeVerificationRepository implements VerificationRepository {
  FakeVerificationRepository({List<VerificationStatus>? statuses, this.sessionError})
    : _statuses = statuses ?? <VerificationStatus>[vStatus(VerificationOutcome.pending)];

  final List<VerificationStatus> _statuses;
  final ApiException? sessionError;
  int sessions = 0;
  int polls = 0;

  @override
  Future<VerificationTicket> startSession(String accessToken) async {
    sessions++;
    if (sessionError != null) throw sessionError!;
    return kTicket;
  }

  @override
  Future<VerificationStatus> status(String accessToken) async {
    polls++;
    return _statuses.length > 1 ? _statuses.removeAt(0) : _statuses.first;
  }
}

/// Stands in for the Smile ID SDK view: two buttons simulate the SDK's callbacks.
class FakeIdentityCapture implements IdentityCapture {
  FakeIdentityCapture({this.available = true});

  @override
  final bool available;
  String? lastNin;
  VerificationTicket? lastTicket;

  @override
  Widget biometricKyc({
    required VerificationTicket ticket,
    required String nin,
    required DateTime consentGrantedAt,
    required VoidCallback onSubmitted,
    required ValueChanged<String> onError,
  }) {
    lastNin = nin;
    lastTicket = ticket;
    return Column(
      children: <Widget>[
        TextButton(onPressed: onSubmitted, child: const Text('SDK: submitted')),
        TextButton(onPressed: () => onError('Camera permission denied'), child: const Text('SDK: error')),
      ],
    );
  }
}

DiscoveryCard card(String id, {String? name, int photos = 2}) => DiscoveryCard(
  userId: id,
  firstName: name ?? 'Member $id',
  age: 29,
  distanceLabel: '6 km away',
  photoUrls: <String>[for (var i = 0; i < photos; i++) 'https://media.example.test/$id/$i'],
  intent: 'relationship',
  bio: 'Bio of $id',
  prompts: const <CardPrompt>[CardPrompt('The green flag I look for…', 'Kindness.')],
  interests: const <String>['afrobeats', 'cooking'],
);

/// Scriptable discovery backend.
class FakeDiscoveryRepository implements DiscoveryRepository {
  FakeDiscoveryRepository({
    List<DiscoveryCard>? cards,
    this.locationRequired = false,
    this.matchOnLike = false,
    this.likeError,
  }) : _cards = cards ?? <DiscoveryCard>[card('a', name: 'Tunde'), card('b', name: 'Emeka'), card('c', name: 'Kunle')];

  final List<DiscoveryCard> _cards;
  bool locationRequired;
  final bool matchOnLike;
  final ApiException? likeError;
  final List<String> calls = <String>[];

  @override
  Future<DiscoveryPage> feed(String accessToken, {String? cursor}) async {
    calls.add('feed');
    if (locationRequired) throw const ApiException(409, 'LOCATION_REQUIRED', 'Share your location');
    return DiscoveryPage(cursor == null ? List.of(_cards) : const <DiscoveryCard>[], null);
  }

  @override
  Future<LikeResult> like(String accessToken, String userId) async {
    calls.add('like:$userId');
    if (likeError != null) throw likeError!;
    return LikeResult(matched: matchOnLike);
  }

  @override
  Future<void> pass(String accessToken, String userId) async => calls.add('pass:$userId');

  @override
  Future<void> updateLocation(String accessToken, double lat, double lng) async {
    calls.add('location:$lat,$lng');
    locationRequired = false;
  }
}

class FakeLocationSource implements LocationSource {
  @override
  Future<({double lat, double lng})?> currentPosition() async => (lat: 6.5244, lng: 3.3792);
}

Widget placeholderImage(BuildContext context, String url) => ColoredBox(color: Colors.brown, child: Text(url));

MatchSummary matchOf(String id, {String name = 'Tunde', int unread = 0, String? last}) => MatchSummary(
  matchId: id,
  userId: 'user-$id',
  firstName: name,
  age: 30,
  verified: true,
  unreadCount: unread,
  lastMessage: last,
);

class FakeMatchesRepository implements MatchesRepository {
  FakeMatchesRepository({List<MatchSummary>? matches}) : matches = matches ?? <MatchSummary>[];

  List<MatchSummary> matches;
  final List<String> calls = <String>[];

  @override
  Future<List<MatchSummary>> list(String accessToken) async {
    calls.add('list');
    return List.of(matches);
  }

  @override
  Future<void> unmatch(String accessToken, String matchId) async {
    calls.add('unmatch:$matchId');
    matches = matches.where((m) => m.matchId != matchId).toList();
  }

  @override
  Future<void> registerPushToken(String accessToken, String token) async => calls.add('token:$token');
}

class FakePushRegistrar implements PushRegistrar {
  final StreamController<String> controller = StreamController<String>.broadcast();
  int starts = 0;
  Future<void> Function(String token)? onToken;

  @override
  Stream<String> get events => controller.stream;

  @override
  Future<void> start(Future<void> Function(String token) onToken) async {
    starts++;
    this.onToken = onToken;
  }

  @override
  Future<void> stop() async {}
}

// ── Chat ────────────────────────────────────────────────────

ChatMessage messageOf(
  String id, {
  required String from,
  String matchId = 'm1',
  String? body,
  DateTime? at,
  DateTime? readAt,
}) => ChatMessage(
  id: id,
  matchId: matchId,
  senderId: from,
  body: body ?? 'Message $id',
  createdAt: at ?? DateTime.utc(2026, 11, 10, 12),
  readAt: readAt,
);

class FakeChatRepository implements ChatRepository {
  FakeChatRepository({
    List<ChatPage>? pages,
    this.photos = const PhotoUnlock(unlocked: false, threshold: 3, mine: 0, theirs: 0),
  }) : pages = pages ?? <ChatPage>[];

  /// Returned in order: the first page, then each older page.
  final List<ChatPage> pages;
  final PhotoUnlock photos;
  final List<String> calls = <String>[];
  ApiException? historyError;
  int _sent = 0;

  @override
  Future<ChatPage> history(String accessToken, String matchId, {String? before}) async {
    calls.add('history:${before ?? '-'}');
    if (historyError != null) throw historyError!;
    final empty = ChatPage(messages: const <ChatMessage>[], photos: photos);
    if (before == null) return pages.isEmpty ? empty : pages.first;
    // `before` is the previous page's next_before: serve the page after it.
    final prev = pages.indexWhere((p) => p.nextBefore == before);
    return prev >= 0 && prev + 1 < pages.length ? pages[prev + 1] : empty;
  }

  @override
  Future<ChatMessage> send(String accessToken, String matchId, String body) async {
    calls.add('send:$body');
    _sent++;
    return ChatMessage(
      id: 'sent-$_sent',
      matchId: matchId,
      senderId: 'me',
      body: body,
      createdAt: DateTime.utc(2026, 11, 10, 13, _sent),
    );
  }

  @override
  Future<void> markRead(String accessToken, String matchId, String upToMessageId) async =>
      calls.add('read:$upToMessageId');
}

/// A scriptable chat socket: [push] simulates server events, [emitted] records client events.
class FakeChatSocket implements ChatSocket {
  FakeChatSocket({this.online = true});

  bool online;
  final StreamController<ChatEvent> _controller = StreamController<ChatEvent>.broadcast();
  final List<ChatEvent> emitted = <ChatEvent>[];
  String? token;
  bool closed = false;

  @override
  Stream<ChatEvent> get events => _controller.stream;

  @override
  bool get connected => online && !closed;

  @override
  Future<void> connect(String accessToken) async => token = accessToken;

  @override
  void emit(String event, Map<String, dynamic> data) => emitted.add(ChatEvent(event, data));

  void push(String event, Map<String, dynamic> data) => _controller.add(ChatEvent(event, data));

  @override
  Future<void> close() async => closed = true;
}

Map<String, dynamic> messageJson(ChatMessage m) => <String, dynamic>{
  'id': m.id,
  'match_id': m.matchId,
  'sender_id': m.senderId,
  'type': 'text',
  'body': m.body,
  'created_at': m.createdAt.toIso8601String(),
  'read_at': m.readAt?.toIso8601String(),
};

// ── Safety ──────────────────────────────────────────────────

class FakeSafetyRepository implements SafetyRepository {
  final List<String> calls = <String>[];
  ApiException? error;

  @override
  Future<void> block(String accessToken, String userId) async {
    if (error != null) throw error!;
    calls.add('block:$userId');
  }

  @override
  Future<void> report(
    String accessToken, {
    required String userId,
    required ReportCategory category,
    String? details,
    String? messageId,
  }) async {
    if (error != null) throw error!;
    calls.add('report:$userId:${category.apiValue}:${details ?? ''}:${messageId ?? '-'}');
  }
}
