import 'package:geolocator/geolocator.dart';

import '../../core/api_client.dart';
import 'discovery_models.dart';

/// GET /discovery, POST /matching/likes and /matching/passes, PUT /profiles/me/location.
abstract interface class DiscoveryRepository {
  Future<DiscoveryPage> feed(String accessToken, {String? cursor});
  Future<LikeResult> like(String accessToken, String userId);
  Future<void> pass(String accessToken, String userId);
  Future<void> updateLocation(String accessToken, double lat, double lng);
}

class HttpDiscoveryRepository implements DiscoveryRepository {
  const HttpDiscoveryRepository(this._api);

  final ApiClient _api;

  @override
  Future<DiscoveryPage> feed(String accessToken, {String? cursor}) async {
    final query = cursor == null ? '' : '?cursor=${Uri.encodeQueryComponent(cursor)}';
    final json = await _api.get('/discovery$query', bearer: accessToken);
    return DiscoveryPage(
      (json['cards'] as List<dynamic>).cast<Map<String, dynamic>>().map(DiscoveryCard.fromJson).toList(),
      json['next_cursor'] as String?,
    );
  }

  @override
  Future<LikeResult> like(String accessToken, String userId) async {
    final json = await _api.post('/matching/likes', bearer: accessToken, body: <String, dynamic>{'user_id': userId});
    return LikeResult(matched: json['matched'] as bool? ?? false);
  }

  @override
  Future<void> pass(String accessToken, String userId) =>
      _api.post('/matching/passes', bearer: accessToken, body: <String, dynamic>{'user_id': userId});

  @override
  Future<void> updateLocation(String accessToken, double lat, double lng) =>
      _api.put('/profiles/me/location', bearer: accessToken, body: <String, dynamic>{'lat': lat, 'lng': lng});
}

/// The device's approximate position. Coarse accuracy only (the manifest asks
/// for ACCESS_COARSE_LOCATION, never fine location).
abstract interface class LocationSource {
  /// Null if the member declines or location services are off.
  Future<({double lat, double lng})?> currentPosition();
}

class DeviceLocationSource implements LocationSource {
  const DeviceLocationSource();

  @override
  Future<({double lat, double lng})?> currentPosition() async {
    if (!await Geolocator.isLocationServiceEnabled()) return null;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) return null;
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.low, timeLimit: Duration(seconds: 20)),
    );
    return (lat: position.latitude, lng: position.longitude);
  }
}
