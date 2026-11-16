import 'dart:async';
import 'dart:typed_data';

import 'package:amivara/features/ai/ai_repository.dart';
import 'package:amivara/features/calls/call_engine.dart';
import 'package:amivara/features/calls/call_repository.dart';
import 'package:amivara/features/gifts/gift_repository.dart';
import 'package:amivara/features/rooms/rooms_repository.dart';
import 'package:amivara/features/hosts/host_screen.dart';
import 'package:amivara/features/wallet/wallet_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/api_client.dart';
import 'package:amivara/core/secure_store.dart';
import 'package:amivara/features/auth/auth_providers.dart';
import 'package:amivara/features/auth/auth_repository.dart';
import 'package:amivara/features/auth/google_auth.dart';
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
import 'package:amivara/features/preferences/preferences_repository.dart';
import 'package:amivara/features/profile/profile_repository.dart';
import 'package:amivara/features/safety/safety_repository.dart';
import 'package:amivara/features/settings/settings_repository.dart';
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
    return MemberSummary(
      firstName: 'Adaeze',
      ageVerified: verified,
      guidelinesAccepted: guidelinesAccepted,
      chatDailyLimit: verified ? null : 10,
    );
  }

  bool guidelinesAccepted = true;
  String? lastEmail;
  String? lastGoogleToken;

  @override
  Future<OtpChallenge> requestEmailOtp(String email) async {
    calls.add('requestEmailOtp:$email');
    lastEmail = email;
    return _next<OtpChallenge>();
  }

  @override
  Future<VerifyResult> googleSignIn(String idToken) async {
    calls.add('googleSignIn');
    lastGoogleToken = idToken;
    return _next<VerifyResult>();
  }

  @override
  Future<void> acceptGuidelines(String accessToken) async {
    calls.add('acceptGuidelines');
    guidelinesAccepted = true;
  }
}

const OtpChallenge kEmailChallenge = OtpChallenge(
  challengeId: 'c-email',
  channel: OtpChannel.email,
  expiresIn: 300,
  resendIn: 60,
);

/// Google Sign-In without the plugin: [token] null means the member cancelled.
class FakeGoogleAuth implements GoogleAuth {
  FakeGoogleAuth({this.available = true, this.token = 'google-id-token'});

  @override
  final bool available;
  final String? token;
  int calls = 0;

  @override
  Future<String?> idToken() async {
    calls++;
    return token;
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
  interests: <String>['afrobeats', 'amapiano', 'football', 'cooking', 'owambe'],
  languages: <LanguageOption>[
    LanguageOption('en', 'English'),
    LanguageOption('pcm', 'Pidgin'),
    LanguageOption('yo', 'Yorùbá'),
    LanguageOption('ig', 'Igbo'),
    LanguageOption('ha', 'Hausa'),
  ],
  maxInterests: 3,
  maxLanguages: 2,
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
  List<String> interests = <String>[];
  List<String> languages = <String>[];
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
    interests: interests,
    languages: languages,
  );

  @override
  Future<MyProfile> updateTags(
    String accessToken, {
    required List<String> interests,
    required List<String> languages,
  }) async {
    calls.add('updateTags:${interests.join(',')}|${languages.join(',')}');
    this.interests = List.of(interests);
    this.languages = List.of(languages);
    return myProfile(accessToken);
  }

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

  /// Profiles that answer 404 (blocked, gone).
  final Set<String> hidden = <String>{};

  @override
  Future<DiscoveryCard> viewProfile(String accessToken, String userId) async {
    calls.add('view:$userId');
    if (hidden.contains(userId)) throw const ApiException(404, 'NOT_FOUND', 'Profile not found.');
    return _cards.firstWhere((c) => c.userId == userId, orElse: () => card(userId, name: 'Kunle'));
  }

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
    if (sendError != null) throw sendError!;
    _sent++;
    return ChatMessage(
      id: 'sent-$_sent',
      matchId: matchId,
      senderId: 'me',
      body: body,
      createdAt: DateTime.utc(2026, 11, 10, 13, _sent),
      safetyNotice: safetyNoticeOnSend,
    );
  }

  /// Thrown by [send] (e.g. VERIFICATION_REQUIRED once the unverified daily cap is hit).
  ApiException? sendError;

  /// Served by icebreakers() (Host tools).
  List<String> icebreakerList = const <String>[];

  @override
  Future<List<String>> icebreakers(String accessToken, String matchId) async {
    calls.add('icebreakers');
    return icebreakerList;
  }

  /// Returned on every sent message (e.g. 'contact_sharing').
  String? safetyNoticeOnSend;

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
  List<BlockedMember> blocked = <BlockedMember>[];

  @override
  Future<List<BlockedMember>> blocks(String accessToken) async => List.of(blocked);

  @override
  Future<void> unblock(String accessToken, String userId) async {
    calls.add('unblock:$userId');
    blocked = blocked.where((b) => b.userId != userId).toList();
  }

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

// ── Settings ────────────────────────────────────────────────

class FakeSettingsRepository implements SettingsRepository {
  FakeSettingsRepository({this.paused = false, this.incognito = false, List<DeviceSession>? sessions})
    : sessionList =
          sessions ??
          <DeviceSession>[
            DeviceSession(
              id: 's-me',
              current: true,
              lastUsedAt: DateTime.now(),
              platform: 'android',
              deviceModel: 'Tecno Spark 20',
            ),
            DeviceSession(
              id: 's-old',
              current: false,
              lastUsedAt: DateTime.now().subtract(const Duration(days: 3)),
              platform: 'android',
              deviceModel: 'Infinix Hot 40',
            ),
          ];

  bool paused;
  bool incognito;
  List<DeviceSession> sessionList;
  final List<String> calls = <String>[];
  ApiException? updateError;

  @override
  Future<AccountSettings> settings(String accessToken) async => AccountSettings(paused: paused, incognito: incognito);

  @override
  Future<AccountSettings> update(String accessToken, {bool? paused, bool? incognito}) async {
    calls.add('update:${paused ?? '-'}:${incognito ?? '-'}');
    if (updateError != null) throw updateError!;
    this.paused = paused ?? this.paused;
    this.incognito = incognito ?? this.incognito;
    return AccountSettings(paused: this.paused, incognito: this.incognito);
  }

  @override
  Future<List<DeviceSession>> sessions(String accessToken) async => List.of(sessionList);

  @override
  Future<void> revokeSession(String accessToken, String sessionId) async {
    calls.add('revoke:$sessionId');
    sessionList = sessionList.where((s) => s.id != sessionId).toList();
  }

  @override
  Future<int> revokeOtherSessions(String accessToken) async {
    calls.add('revoke-others');
    final count = sessionList.where((s) => !s.current).length;
    sessionList = sessionList.where((s) => s.current).toList();
    return count;
  }

  @override
  Future<String> exportData(String accessToken) async {
    calls.add('export');
    return '{"format": "amivara-export/1"}';
  }

  @override
  Future<DateTime> deleteAccount(String accessToken) async {
    calls.add('delete');
    return DateTime.utc(2026, 12, 10);
  }
}

class FakeDataSaver implements DataSaver {
  final List<String> saved = <String>[];

  @override
  Future<void> save(String fileName, String json) async => saved.add('$fileName:$json');
}

// ── Preferences ─────────────────────────────────────────────

class FakePreferencesRepository implements PreferencesRepository {
  DiscoveryPreferences prefs = const DiscoveryPreferences(
    interestedIn: <SeekGender>{SeekGender.man},
    ageMin: 22,
    ageMax: 32,
    maxDistanceKm: 50,
  );
  final List<String> calls = <String>[];
  ApiException? updateError;

  @override
  Future<DiscoveryPreferences> get(String accessToken) async => prefs;

  @override
  Future<DiscoveryPreferences> update(String accessToken, DiscoveryPreferences next) async {
    calls.add('update:${next.toJson()}');
    if (updateError != null) throw updateError!;
    return prefs = next;
  }
}

// ── Wallet / top-ups (M2) ──

const List<CoinPackage> kPackages = <CoinPackage>[
  CoinPackage(id: 'p500', coins: 500, totalCoins: 600, firstPurchaseBonus: 100, priceNgn: 1000),
  CoinPackage(
    id: 'p2000',
    coins: 2000,
    totalCoins: 2400,
    firstPurchaseBonus: 400,
    priceNgn: 3500,
    label: 'Most popular',
  ),
  CoinPackage(id: 'p10000', coins: 10000, totalCoins: 12000, firstPurchaseBonus: 2000, priceNgn: 15000),
  CoinPackage(id: 'p30000', coins: 30000, totalCoins: 37500, firstPurchaseBonus: 7500, priceNgn: 40000),
];

class FakeWalletRepository implements WalletRepository {
  FakeWalletRepository({this.balance = 100, this.providers = const <String>['paystack']});

  int balance;
  final List<String> providers;
  final List<String> calls = <String>[];

  /// What GET /wallet/topups/:id answers next (default: still pending).
  final List<TopupStatus> statuses = <TopupStatus>[];
  ApiException? startError;
  CoinPackage? _buying;

  @override
  Future<Wallet> wallet(String accessToken) async {
    calls.add('wallet');
    return Wallet(balance: balance, firstPurchaseEligible: true, packages: kPackages, paymentProviders: providers);
  }

  @override
  Future<Topup> startTopup(String accessToken, {required String packageId, required String provider}) async {
    calls.add('start:$packageId:$provider');
    if (startError != null) throw startError!;
    _buying = kPackages.firstWhere((p) => p.id == packageId);
    return Topup(
      id: 't-1',
      status: TopupStatus.pending,
      coins: _buying!.coins,
      checkoutUrl: 'https://checkout.paystack.test/amv_1',
    );
  }

  @override
  Future<Topup> topup(String accessToken, String id) async {
    calls.add('poll:$id');
    final status = statuses.isEmpty ? TopupStatus.pending : statuses.removeAt(0);
    if (status == TopupStatus.succeeded) balance += _buying!.totalCoins;
    return Topup(
      id: id,
      status: status,
      coins: _buying!.coins,
      totalCoins: status == TopupStatus.succeeded ? _buying!.totalCoins : null,
      balance: status == TopupStatus.succeeded ? balance : null,
    );
  }
}

class FakeCheckoutLauncher implements CheckoutLauncher {
  final List<Uri> opened = <Uri>[];
  bool succeed = true;

  @override
  Future<bool> open(Uri url) async {
    opened.add(url);
    return succeed;
  }
}

class FakeHostRepository implements HostRepository {
  FakeHostRepository({this.state = const HostState()});

  HostState state;
  final List<String> calls = <String>[];

  @override
  Future<HostState> load(String accessToken) async {
    calls.add('load');
    return state;
  }

  @override
  Future<HostState> optIn(String accessToken) async {
    calls.add('optIn');
    return state = HostState(status: 'active', pendingCoins: state.pendingCoins, availableCoins: state.availableCoins);
  }

  @override
  Future<HostState> pause(String accessToken) async {
    calls.add('pause');
    return state = HostState(status: 'paused', pendingCoins: state.pendingCoins, availableCoins: state.availableCoins);
  }
}

// ── AI Companions (M3b) ──

const List<AiCompanion> kCompanions = <AiCompanion>[
  AiCompanion(slug: 'ada', name: 'Ada', tagline: 'Bookworm and late-night philosopher', bio: ''),
  AiCompanion(slug: 'tolu', name: 'Tolu', tagline: 'Foodie with strong jollof opinions', bio: ''),
];

class FakeAiRepository implements AiRepository {
  FakeAiRepository({this.available = true});

  bool available;
  final List<String> calls = <String>[];
  ApiException? sendError;
  SpendLimits limitsState = const SpendLimits(effectiveCap: 200);
  int _n = 0;

  @override
  Future<({bool available, List<AiCompanion> companions})> companions(String accessToken) async =>
      (available: available, companions: kCompanions);

  @override
  Future<AiConversation> open(String accessToken, String slug) async {
    calls.add('open:$slug');
    final c = kCompanions.firstWhere((p) => p.slug == slug);
    return AiConversation(
      id: 'conv-$slug',
      companion: c,
      messages: <AiMessage>[
        AiMessage(id: 'greet', fromCompanion: true, body: "Hi, I'm ${c.name}, an AI Companion (not a real person)."),
      ],
      billing: const AiBilling(priceCoins: 10, freePerDay: 3, freeRemainingToday: 3),
    );
  }

  @override
  Future<AiSendResult> send(String accessToken, String conversationId, String body) async {
    calls.add('send:$body');
    if (sendError != null) throw sendError!;
    _n++;
    return AiSendResult(
      message: AiMessage(id: 'm$_n', fromCompanion: false, body: body),
      reply: AiMessage(id: 'r$_n', fromCompanion: true, body: 'Reply $_n'),
      balance: 100,
      billing: AiBilling(priceCoins: 10, freePerDay: 3, freeRemainingToday: 3 - _n < 0 ? 0 : 3 - _n),
    );
  }

  @override
  Future<void> report(String accessToken, String messageId) async => calls.add('report:$messageId');

  @override
  Future<void> delete(String accessToken, String conversationId) async => calls.add('delete:$conversationId');

  @override
  Future<SpendLimits> limits(String accessToken) async => limitsState;

  @override
  Future<SpendLimits> setCap(String accessToken, int? cap) async {
    calls.add('cap:$cap');
    return limitsState = SpendLimits(aiDailyCapCoins: cap, effectiveCap: cap ?? limitsState.effectiveCap);
  }

  @override
  Future<SpendLimits> selfExclude(String accessToken, int days) async {
    calls.add('exclude:$days');
    return limitsState = SpendLimits(selfExcludedUntil: DateTime.utc(2026, 12, 15));
  }
}

// ── Calls (M4/M5) ──

Map<String, dynamic> callJson(
  String id, {
  String status = 'ringing',
  bool caller = true,
  String type = 'voice',
  int rate = 0,
  String matchId = 'm1',
  int billed = 0,
  String? startedAt,
}) => <String, dynamic>{
  'id': id,
  'match_id': matchId,
  'type': type,
  'status': status,
  'role': caller ? 'caller' : 'callee',
  'other_user_id': 'user-$matchId',
  'rate_per_minute': rate,
  'paid': rate > 0,
  'started_at': startedAt,
  'billed_minutes': billed,
  'end_reason': null,
};

class FakeCallRepository implements CallRepository {
  FakeCallRepository({
    this.quoteResult = const CallQuote(available: true, allowed: true, paid: false, voiceRate: 0, videoRate: 0),
  });

  CallQuote quoteResult;
  ApiException? startError;
  int rate = 0;
  int? joinBalance;
  String _type = 'voice';
  final List<String> calls = <String>[];

  CallMedia get _media => const CallMedia(url: 'wss://lk.test', token: 'tok');

  @override
  Future<CallQuote> quote(String accessToken, String matchId) async => quoteResult;

  @override
  Future<CallInfo> start(String accessToken, String matchId, CallType type) async {
    calls.add('start:$matchId:${type.name}');
    if (startError != null) throw startError!;
    _type = type.name;
    return CallInfo.fromJson(callJson('c1', type: type.name, rate: rate, matchId: matchId));
  }

  @override
  Future<({CallInfo call, CallMedia media})> accept(String accessToken, String callId) async {
    calls.add('accept:$callId');
    return (call: CallInfo.fromJson(callJson(callId, status: 'active', caller: false, type: 'video')), media: _media);
  }

  @override
  Future<({CallInfo call, CallMedia media, int? balance})> join(String accessToken, String callId) async {
    calls.add('join:$callId');
    return (
      call: CallInfo.fromJson(callJson(callId, status: 'active', rate: rate, type: _type, billed: rate > 0 ? 1 : 0)),
      media: _media,
      balance: joinBalance,
    );
  }

  @override
  Future<CallInfo> decline(String accessToken, String callId) async {
    calls.add('decline:$callId');
    return CallInfo.fromJson(callJson(callId, status: 'declined', caller: false));
  }

  @override
  Future<CallInfo> end(String accessToken, String callId) async {
    calls.add('end:$callId');
    return CallInfo.fromJson(callJson(callId, status: 'ended'));
  }

  @override
  Future<({CallInfo call, String otherName})?> current(String accessToken) async => null;
}

class FakeCallEngine implements CallEngine {
  final List<String> log = <String>[];
  final StreamController<void> _ended = StreamController<void>.broadcast();
  final ChangeNotifier _changes = ChangeNotifier();

  void remoteHungUp() => _ended.add(null);

  @override
  Future<void> connect({required String url, required String token, required bool video, bool publish = true}) async =>
      log.add('connect:${video ? 'video' : 'voice'}${publish ? '' : ':listen'}');
  @override
  Future<void> setPublishing(bool on, {required bool video}) async => log.add('publish:$on');
  @override
  Future<void> setMicrophone(bool on) async => log.add('mic:$on');
  @override
  Future<void> setCamera(bool on) async => log.add('camera:$on');
  @override
  Future<void> switchCamera(bool front) async => log.add('front:$front');
  @override
  Future<void> setSpeaker(bool on) async => log.add('speaker:$on');
  @override
  Future<void> disconnect() async => log.add('disconnect');
  @override
  Stream<void> get ended => _ended.stream;
  @override
  Listenable get changes => _changes;
  @override
  bool get remoteConnected => true;
  @override
  Widget remoteVideo() => const SizedBox(key: Key('remote-video'));
  @override
  Widget localVideo() => const SizedBox(key: Key('local-video'));
}

// ── Gifts and Chat House rooms (M6/7) ──

const List<Gift> kGifts = <Gift>[
  Gift(id: 'g-rose', slug: 'rose', name: 'Rose', emoji: '🌹', priceCoins: 20),
  Gift(id: 'g-kiss', slug: 'kiss', name: 'Kiss', emoji: '💋', priceCoins: 50),
  Gift(id: 'g-teddy', slug: 'teddy', name: 'Teddy', emoji: '🧸', priceCoins: 200),
  Gift(id: 'g-crown', slug: 'crown', name: 'Crown', emoji: '👑', priceCoins: 1000),
];

class FakeGiftRepository implements GiftRepository {
  int balance = 500;
  final List<String> calls = <String>[];

  /// Errors to throw on the next sends, in order.
  final List<ApiException> errors = <ApiException>[];

  @override
  Future<List<Gift>> catalogue(String accessToken) async => kGifts;

  Gift _gift(String id) => kGifts.firstWhere((g) => g.id == id);

  void _charge(String giftId) {
    if (errors.isNotEmpty) throw errors.removeAt(0);
    balance -= _gift(giftId).priceCoins;
  }

  @override
  Future<({ChatMessage message, int balance})> sendInChat(
    String accessToken,
    String matchId,
    String giftId,
    String idempotencyKey,
  ) async {
    calls.add('chat:$matchId:${_gift(giftId).slug}:$idempotencyKey');
    _charge(giftId);
    final g = _gift(giftId);
    return (
      message: ChatMessage(
        id: 'gift-msg-${calls.length}',
        matchId: matchId,
        senderId: 'me',
        body: '',
        createdAt: DateTime.utc(2026, 11, 10, 13),
        gift: GiftInfo(slug: g.slug, name: g.name, emoji: g.emoji),
      ),
      balance: balance,
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
    calls.add('room:$roomId:${_gift(giftId).slug}:${recipientId ?? 'host'}');
    _charge(giftId);
    return balance;
  }
}

Map<String, dynamic> roomJson({
  String id = 'r1',
  String role = 'listener',
  bool video = false,
  bool seatRequested = false,
  bool following = false,
  bool mutedByHost = false,
  List<Map<String, dynamic>> guests = const <Map<String, dynamic>>[],
  List<Map<String, dynamic>> requests = const <Map<String, dynamic>>[],
  int listeners = 3,
}) => <String, dynamic>{
  'id': id,
  'title': 'Friday vibes',
  'mode': video ? 'video' : 'audio',
  'audience': 'open',
  'status': 'live',
  'max_seats': 8,
  'host': <String, dynamic>{'id': 'host-1', 'first_name': 'Ada'},
  'speakers': <Map<String, dynamic>>[
    <String, dynamic>{'id': 'host-1', 'first_name': 'Ada', 'role': 'host', 'muted_by_host': false},
    ...guests,
  ],
  'listeners': listeners,
  if (role == 'host') 'seat_requests': requests,
  'me': <String, dynamic>{
    'id': role == 'host' ? 'host-1' : 'me',
    'role': role,
    'seat_requested': seatRequested,
    'muted_by_host': mutedByHost,
    'following': following,
  },
};

class FakeRoomsRepository implements RoomsRepository {
  FakeRoomsRepository({List<RoomSummary>? rooms, Map<String, dynamic>? joinAs})
    : rooms = rooms ?? <RoomSummary>[],
      joinAs = joinAs ?? roomJson();

  List<RoomSummary> rooms;
  Map<String, dynamic> joinAs;
  ApiException? openError;
  ApiException? joinError;
  final List<String> calls = <String>[];
  final List<RoomMessage> history = <RoomMessage>[];
  ApiException? sendError;

  static const CallMedia media = CallMedia(url: 'wss://lk.test', token: 'room-token');

  @override
  Future<List<RoomSummary>> list(String accessToken) async => rooms;

  @override
  Future<({Room room, CallMedia media})> open(
    String accessToken, {
    required String title,
    required bool video,
    required bool followersOnly,
  }) async {
    calls.add('open:$title:${video ? 'video' : 'audio'}:${followersOnly ? 'followers' : 'open'}');
    if (openError != null) throw openError!;
    return (room: Room.fromJson(roomJson(id: 'r-new', role: 'host', video: video, listeners: 0)), media: media);
  }

  @override
  Future<({Room room, CallMedia media})> join(String accessToken, String roomId) async {
    calls.add('join:$roomId');
    if (joinError != null) throw joinError!;
    return (room: Room.fromJson(joinAs), media: media);
  }

  @override
  Future<void> leave(String accessToken, String roomId) async => calls.add('leave:$roomId');
  @override
  Future<void> end(String accessToken, String roomId) async => calls.add('end:$roomId');
  @override
  Future<void> requestSeat(String accessToken, String roomId) async => calls.add('ask:$roomId');
  @override
  Future<void> cancelSeatRequest(String accessToken, String roomId) async => calls.add('cancel-ask:$roomId');
  @override
  Future<void> seat(String accessToken, String roomId, String userId) async => calls.add('seat:$userId');
  @override
  Future<void> unseat(String accessToken, String roomId, String userId) async => calls.add('unseat:$userId');
  @override
  Future<void> setMuted(String accessToken, String roomId, String userId, bool muted) async =>
      calls.add('${muted ? 'mute' : 'unmute'}:$userId');
  @override
  Future<void> ban(String accessToken, String roomId, String userId) async => calls.add('ban:$userId');
  @override
  Future<List<RoomMessage>> messages(String accessToken, String roomId) async => history;
  @override
  Future<RoomMessage> send(String accessToken, String roomId, String body) async {
    calls.add('say:$body');
    if (sendError != null) throw sendError!;
    return RoomMessage(id: 'rm-${calls.length}', senderId: 'me', senderName: 'Me', body: body);
  }

  @override
  Future<void> follow(String accessToken, String hostId, bool follow) async =>
      calls.add('${follow ? 'follow' : 'unfollow'}:$hostId');
  @override
  Future<void> report(String accessToken, String roomId, {required String category, String? details}) async =>
      calls.add('report:$roomId:$category');
}
