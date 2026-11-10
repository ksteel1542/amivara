import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'photo_processor.dart';
import 'profile_repository.dart';

/// Overridden in main.dart (HTTP + device picker) and in tests (fakes).
final profileRepositoryProvider = Provider<ProfileRepository>((ref) => throw UnimplementedError('override in main'));
final photoProcessorProvider = Provider<PhotoProcessor>((ref) => DevicePhotoProcessor());
