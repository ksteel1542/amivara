import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../notifications/push_registrar.dart';
import 'matches_repository.dart';

/// Overridden in main.dart and in tests.
final matchesRepositoryProvider = Provider<MatchesRepository>((ref) => throw UnimplementedError('override in main'));
final pushRegistrarProvider = Provider<PushRegistrar>((ref) => FcmPushRegistrar());
