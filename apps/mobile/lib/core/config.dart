/// Build-time configuration: `flutter run --dart-define=API_BASE_URL=https://api.staging.amivara.com/v1`.
abstract final class AppConfig {
  /// Defaults to the local API as seen from the Android emulator.
  /// Checkout for this build (MONETIZATION_PLAN.md 2a): 'paystack' for the direct APK,
  /// 'google_play' for the Play Store build. The API decides whether it's accepted.
  static const String paymentProvider = String.fromEnvironment('PAYMENT_PROVIDER', defaultValue: 'paystack');

  static const String apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:4000/v1');
}
