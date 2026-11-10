import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'discovery_repository.dart';

/// Overridden in main.dart and in tests.
final discoveryRepositoryProvider = Provider<DiscoveryRepository>(
  (ref) => throw UnimplementedError('override in main'),
);
final locationSourceProvider = Provider<LocationSource>((ref) => const DeviceLocationSource());
