class CardPrompt {
  const CardPrompt(this.prompt, this.answer);
  final String prompt;
  final String answer;
}

/// One profile in the discovery stack (GET /discovery). Never carries coordinates.
class DiscoveryCard {
  const DiscoveryCard({
    required this.userId,
    required this.firstName,
    required this.age,
    required this.distanceLabel,
    required this.photoUrls,
    this.verified = true,
    this.intent,
    this.bio,
    this.prompts = const <CardPrompt>[],
    this.interests = const <String>[],
  });

  factory DiscoveryCard.fromJson(Map<String, dynamic> json) => DiscoveryCard(
    userId: json['user_id'] as String,
    firstName: json['first_name'] as String,
    age: (json['age'] as num).toInt(),
    verified: json['verified'] as bool? ?? true,
    distanceLabel: (json['distance'] as Map<String, dynamic>)['label'] as String,
    intent: json['intent'] as String?,
    bio: json['bio'] as String?,
    prompts: (json['prompts'] as List<dynamic>? ?? const <dynamic>[])
        .cast<Map<String, dynamic>>()
        .map((p) => CardPrompt(p['prompt'] as String, p['answer'] as String))
        .toList(),
    interests: (json['interests'] as List<dynamic>? ?? const <dynamic>[]).cast<String>(),
    photoUrls: (json['photos'] as List<dynamic>).cast<Map<String, dynamic>>().map((p) => p['url'] as String).toList(),
  );

  final String userId;
  final String firstName;
  final int age;
  final bool verified;
  final String distanceLabel;
  final String? intent;
  final String? bio;
  final List<CardPrompt> prompts;
  final List<String> interests;
  final List<String> photoUrls;
}

class DiscoveryPage {
  const DiscoveryPage(this.cards, this.nextCursor);
  final List<DiscoveryCard> cards;
  final String? nextCursor;
}

class LikeResult {
  const LikeResult({required this.matched});
  final bool matched;
}
