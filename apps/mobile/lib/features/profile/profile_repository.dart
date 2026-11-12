import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../../core/api_client.dart';
import '../auth/auth_repository.dart';
import 'profile_models.dart';

/// Profile and photo endpoints (docs/API.md "Profiles" and "Media").
abstract interface class ProfileRepository {
  Future<ProfileCatalog> catalog(String accessToken);
  Future<MyProfile> myProfile(String accessToken);
  Future<MyProfile> updateProfile(String accessToken, {String? bio, DatingIntent? intent, List<PromptAnswer>? prompts});

  /// Interests and languages (PATCH /profiles/me): other members see them on your card.
  Future<MyProfile> updateTags(String accessToken, {required List<String> interests, required List<String> languages});

  /// Reserve → direct upload to S3 → confirm. Returns the updated photo list.
  Future<List<ProfilePhoto>> uploadPhoto(String accessToken, Uint8List jpegBytes);
  Future<List<ProfilePhoto>> reorderPhotos(String accessToken, List<String> photoIds);
  Future<List<ProfilePhoto>> makePrimary(String accessToken, String photoId);
  Future<List<ProfilePhoto>> deletePhoto(String accessToken, String photoId);
}

class HttpProfileRepository implements ProfileRepository {
  HttpProfileRepository(this._api, {http.Client? uploadClient}) : _upload = uploadClient ?? http.Client();

  final ApiClient _api;
  final http.Client _upload;

  @override
  Future<ProfileCatalog> catalog(String accessToken) async =>
      ProfileCatalog.fromJson(await _api.get('/profiles/catalog', bearer: accessToken));

  @override
  Future<MyProfile> myProfile(String accessToken) async =>
      MyProfile.fromJson(await _api.get('/profiles/me', bearer: accessToken));

  @override
  Future<MyProfile> updateTags(
    String accessToken, {
    required List<String> interests,
    required List<String> languages,
  }) async => MyProfile.fromJson(
    await _api.patch(
      '/profiles/me',
      bearer: accessToken,
      body: <String, dynamic>{'interests': interests, 'languages': languages},
    ),
  );

  @override
  Future<MyProfile> updateProfile(
    String accessToken, {
    String? bio,
    DatingIntent? intent,
    List<PromptAnswer>? prompts,
  }) async {
    final json = await _api.patch(
      '/profiles/me',
      bearer: accessToken,
      body: <String, dynamic>{
        'bio': ?bio,
        if (intent != null) 'intent': intent.api,
        if (prompts != null) 'prompts': prompts.map((p) => p.toJson()).toList(),
      },
    );
    return MyProfile.fromJson(json);
  }

  @override
  Future<List<ProfilePhoto>> uploadPhoto(String accessToken, Uint8List jpegBytes) async {
    final ticket = UploadTicket.fromJson(
      await _api.post('/media/upload-url', bearer: accessToken, body: <String, dynamic>{'content_type': 'image/jpeg'}),
    );
    if (jpegBytes.length > ticket.maxBytes) {
      throw const ApiException(413, 'PHOTO_TOO_LARGE', 'That photo is too large. Try another one.');
    }

    // Straight to S3 with the presigned POST: fields first, file last.
    final request = http.MultipartRequest('POST', Uri.parse(ticket.url))
      ..fields.addAll(ticket.fields)
      ..files.add(http.MultipartFile.fromBytes(ticket.fileField, jpegBytes, filename: 'photo.jpg'));
    final response = await _upload.send(request).timeout(const Duration(seconds: 60));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        response.statusCode,
        'UPLOAD_FAILED',
        "Your photo didn't upload. Check your connection and try again.",
      );
    }

    final json = await _api.post('/media/photos/${ticket.photoId}/confirm', bearer: accessToken);
    return photosFromJson(json['photos'] as List<dynamic>);
  }

  @override
  Future<List<ProfilePhoto>> reorderPhotos(String accessToken, List<String> photoIds) async {
    final json = await _api.put(
      '/media/photos/order',
      bearer: accessToken,
      body: <String, dynamic>{'photo_ids': photoIds},
    );
    return photosFromJson(json['photos'] as List<dynamic>);
  }

  @override
  Future<List<ProfilePhoto>> makePrimary(String accessToken, String photoId) async {
    final json = await _api.put('/media/photos/$photoId/primary', bearer: accessToken);
    return photosFromJson(json['photos'] as List<dynamic>);
  }

  @override
  Future<List<ProfilePhoto>> deletePhoto(String accessToken, String photoId) async {
    final json = await _api.delete('/media/photos/$photoId', bearer: accessToken);
    return photosFromJson(json['photos'] as List<dynamic>);
  }
}
