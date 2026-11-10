import '../auth/auth_repository.dart';

class PromptOption {
  const PromptOption(this.id, this.text);
  final String id;
  final String text;
}

class ProfileCatalog {
  const ProfileCatalog({
    required this.prompts,
    required this.maxPrompts,
    required this.maxBio,
    required this.maxPhotos,
    required this.minPhotos,
  });

  factory ProfileCatalog.fromJson(Map<String, dynamic> json) {
    final limits = json['limits'] as Map<String, dynamic>;
    final photos = limits['photos'] as Map<String, dynamic>;
    return ProfileCatalog(
      prompts: (json['prompts'] as List<dynamic>)
          .cast<Map<String, dynamic>>()
          .map((p) => PromptOption(p['id'] as String, p['text'] as String))
          .toList(),
      maxPrompts: (limits['prompts'] as num).toInt(),
      maxBio: (limits['bio'] as num).toInt(),
      maxPhotos: (photos['max'] as num).toInt(),
      minPhotos: (photos['min'] as num).toInt(),
    );
  }

  final List<PromptOption> prompts;
  final int maxPrompts;
  final int maxBio;
  final int maxPhotos;
  final int minPhotos;

  String promptText(String id) => prompts.firstWhere((p) => p.id == id, orElse: () => PromptOption(id, id)).text;
}

class PromptAnswer {
  const PromptAnswer(this.promptId, this.answer);

  factory PromptAnswer.fromJson(Map<String, dynamic> json) =>
      PromptAnswer(json['prompt_id'] as String, json['answer'] as String);

  final String promptId;
  final String answer;

  Map<String, dynamic> toJson() => <String, dynamic>{'prompt_id': promptId, 'answer': answer};
}

class ProfilePhoto {
  const ProfilePhoto({required this.id, required this.url, required this.isPrimary});

  factory ProfilePhoto.fromJson(Map<String, dynamic> json) =>
      ProfilePhoto(id: json['id'] as String, url: json['url'] as String, isPrimary: json['is_primary'] as bool);

  final String id;
  final String url;
  final bool isPrimary;
}

class MyProfile {
  const MyProfile({
    required this.firstName,
    required this.bio,
    required this.intent,
    required this.prompts,
    required this.photos,
  });

  factory MyProfile.fromJson(Map<String, dynamic> json) => MyProfile(
    firstName: json['first_name'] as String,
    bio: json['bio'] as String?,
    intent: intentFromApi(json['intent'] as String),
    prompts: (json['prompts'] as List<dynamic>).cast<Map<String, dynamic>>().map(PromptAnswer.fromJson).toList(),
    photos: photosFromJson(json['photos'] as List<dynamic>),
  );

  final String firstName;
  final String? bio;
  final DatingIntent intent;
  final List<PromptAnswer> prompts;
  final List<ProfilePhoto> photos;
}

List<ProfilePhoto> photosFromJson(List<dynamic> list) =>
    list.cast<Map<String, dynamic>>().map(ProfilePhoto.fromJson).toList();

DatingIntent intentFromApi(String value) => DatingIntent.values.firstWhere((i) => i.api == value);

/// Presigned POST returned by POST /media/upload-url.
class UploadTicket {
  const UploadTicket({
    required this.photoId,
    required this.url,
    required this.fields,
    required this.fileField,
    required this.maxBytes,
  });

  factory UploadTicket.fromJson(Map<String, dynamic> json) {
    final upload = json['upload'] as Map<String, dynamic>;
    return UploadTicket(
      photoId: json['photo_id'] as String,
      url: upload['url'] as String,
      fields: (upload['fields'] as Map<String, dynamic>).map((k, v) => MapEntry(k, v.toString())),
      fileField: upload['file_field'] as String,
      maxBytes: (json['max_bytes'] as num).toInt(),
    );
  }

  final String photoId;
  final String url;
  final Map<String, String> fields;
  final String fileField;
  final int maxBytes;
}
