import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'app_router.dart';
import 'core/api_client.dart';
import 'core/config.dart';
import 'core/secure_store.dart';
import 'features/auth/auth_providers.dart';
import 'features/auth/auth_repository.dart';
import 'features/discovery/discovery_providers.dart';
import 'features/matches/matches_providers.dart';
import 'features/matches/matches_repository.dart';
import 'features/discovery/discovery_repository.dart';
import 'features/profile/profile_providers.dart';
import 'features/profile/profile_repository.dart';
import 'features/verification/identity_capture.dart';
import 'features/verification/verification_providers.dart';
import 'features/verification/verification_repository.dart';
import 'theme/amivara_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  registerFontLicenses();

  const store = DeviceSecureStore();
  final deviceId = await loadOrCreateDeviceId(store);
  final api = ApiClient(baseUrl: AppConfig.apiBaseUrl, deviceId: deviceId);
  final smileIdReady = await SmileIdCapture.initialize();

  final container = ProviderContainer(
    overrides: [
      secureStoreProvider.overrideWithValue(store),
      authRepositoryProvider.overrideWithValue(HttpAuthRepository(api)),
      profileRepositoryProvider.overrideWithValue(HttpProfileRepository(api)),
      verificationRepositoryProvider.overrideWithValue(HttpVerificationRepository(api)),
      discoveryRepositoryProvider.overrideWithValue(HttpDiscoveryRepository(api)),
      matchesRepositoryProvider.overrideWithValue(HttpMatchesRepository(api)),
      identityCaptureProvider.overrideWithValue(SmileIdCapture(initialized: smileIdReady)),
    ],
  );
  final restored = await container.read(sessionProvider.notifier).restore();

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: AmivaraApp(initialLocation: restored ? '/home' : '/'),
    ),
  );
}

/// The bundled fonts are licensed under the SIL OFL 1.1, which requires the
/// licence to ship with them. This shows them on Flutter's licence page.
void registerFontLicenses() {
  LicenseRegistry.addLicense(() async* {
    for (final (family, file) in const [('Playfair', 'OFL-Playfair.txt'), ('Inter', 'OFL-Inter.txt')]) {
      final text = await rootBundle.loadString('assets/fonts/$file');
      yield LicenseEntryWithLineBreaks(<String>[family], text);
    }
  });
}

class AmivaraApp extends ConsumerStatefulWidget {
  const AmivaraApp({super.key, this.initialLocation = '/'});

  final String initialLocation;

  @override
  ConsumerState<AmivaraApp> createState() => _AmivaraAppState();
}

class _AmivaraAppState extends ConsumerState<AmivaraApp> {
  late final GoRouter _router = buildRouter(ref, initialLocation: widget.initialLocation);

  @override
  void initState() {
    super.initState();
    // Register for push whenever a session starts (also right away when restored at launch).
    ref.listenManual(sessionProvider, (previous, next) {
      if (next == null) {
        ref.read(pushRegistrarProvider).stop();
      } else if (previous == null) {
        ref.read(pushRegistrarProvider).start((token) async {
          final session = ref.read(sessionProvider);
          if (session == null) return;
          try {
            await ref.read(matchesRepositoryProvider).registerPushToken(session.accessToken, token);
          } on Object {
            // Retried on the next launch or token refresh; never blocks the app.
          }
        });
      }
    }, fireImmediately: true);
  }

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'AMIVARA',
      debugShowCheckedModeBanner: false,
      theme: AmivaraTheme.light(),
      darkTheme: AmivaraTheme.dark(),
      themeMode: ThemeMode.system,
      routerConfig: _router,
    );
  }
}
