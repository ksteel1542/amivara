/// Build-time configuration: `flutter run --dart-define=API_BASE_URL=https://api.staging.amivara.com/v1`.
abstract final class AppConfig {
  /// Defaults to the local API as seen from the Android emulator.
  static const String apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:4000/v1');
}
