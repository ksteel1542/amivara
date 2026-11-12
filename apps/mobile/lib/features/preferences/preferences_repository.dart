import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';

/// The genders a member can choose to see (API values).
enum SeekGender {
  woman('woman', 'Women'),
  man('man', 'Men'),
  nonBinary('non_binary', 'Non-binary people');

  const SeekGender(this.api, this.label);
  final String api;
  final String label;

  static SeekGender fromApi(String v) => values.firstWhere((g) => g.api == v);
}

/// Discovery preferences (GET/PATCH /me/preferences).
class DiscoveryPreferences {
  const DiscoveryPreferences({
    required this.interestedIn,
    required this.ageMin,
    required this.ageMax,
    required this.maxDistanceKm,
  });

  factory DiscoveryPreferences.fromJson(Map<String, dynamic> json) => DiscoveryPreferences(
    interestedIn: (json['interested_in'] as List<dynamic>).cast<String>().map(SeekGender.fromApi).toSet(),
    ageMin: (json['age_min'] as num).toInt(),
    ageMax: (json['age_max'] as num).toInt(),
    maxDistanceKm: (json['max_distance_km'] as num).toInt(),
  );

  /// Never below 18 (PRD §4): the API and the database refuse anything lower.
  static const int ageFloor = 18;
  static const int ageCeiling = 99;
  static const int minDistanceKm = 1;
  static const int maxDistanceLimitKm = 300;

  final Set<SeekGender> interestedIn;
  final int ageMin;
  final int ageMax;
  final int maxDistanceKm;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'interested_in': SeekGender.values.where(interestedIn.contains).map((g) => g.api).toList(),
    'age_min': ageMin,
    'age_max': ageMax,
    'max_distance_km': maxDistanceKm,
  };
}

abstract interface class PreferencesRepository {
  Future<DiscoveryPreferences> get(String accessToken);
  Future<DiscoveryPreferences> update(String accessToken, DiscoveryPreferences prefs);
}

class HttpPreferencesRepository implements PreferencesRepository {
  const HttpPreferencesRepository(this._api);

  final ApiClient _api;

  @override
  Future<DiscoveryPreferences> get(String accessToken) async =>
      DiscoveryPreferences.fromJson(await _api.get('/me/preferences', bearer: accessToken));

  @override
  Future<DiscoveryPreferences> update(String accessToken, DiscoveryPreferences prefs) async =>
      DiscoveryPreferences.fromJson(await _api.patch('/me/preferences', bearer: accessToken, body: prefs.toJson()));
}

/// Overridden in main.dart and in tests.
final preferencesRepositoryProvider = Provider<PreferencesRepository>(
  (ref) => throw UnimplementedError('override in main'),
);
