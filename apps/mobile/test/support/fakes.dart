import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/core/api_client.dart';
import 'package:amivara/core/secure_store.dart';
import 'package:amivara/features/auth/auth_providers.dart';
import 'package:amivara/features/auth/auth_repository.dart';
import 'package:amivara/features/profile/photo_processor.dart';
import 'package:amivara/features/profile/profile_models.dart';
import 'package:amivara/features/profile/profile_providers.dart';
import 'package:amivara/features/profile/profile_repository.dart';
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

  @override
  Future<MemberSummary> me(String accessToken) async {
    calls.add('me');
    return const MemberSummary(firstName: 'Adaeze', ageVerified: false);
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
