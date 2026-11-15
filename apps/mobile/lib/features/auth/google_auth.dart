import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';

/// Google Sign-In. Off unless the build sets `--dart-define=GOOGLE_SERVER_CLIENT_ID=...`
/// (the Web OAuth client id the API accepts, listed in its GOOGLE_CLIENT_IDS).
abstract interface class GoogleAuth {
  bool get available;

  /// Google's ID token for this app, or null if the member cancelled.
  Future<String?> idToken();
}

class PluginGoogleAuth implements GoogleAuth {
  static const String serverClientId = String.fromEnvironment('GOOGLE_SERVER_CLIENT_ID');
  bool _initialized = false;

  @override
  bool get available => serverClientId.isNotEmpty;

  @override
  Future<String?> idToken() async {
    final google = GoogleSignIn.instance;
    if (!_initialized) {
      await google.initialize(serverClientId: serverClientId);
      _initialized = true;
    }
    if (!google.supportsAuthenticate()) return null;
    try {
      final account = await google.authenticate();
      return account.authentication.idToken;
    } on GoogleSignInException catch (e) {
      if (e.code == GoogleSignInExceptionCode.canceled) return null;
      rethrow;
    }
  }
}

/// Overridden in tests.
final googleAuthProvider = Provider<GoogleAuth>((ref) => PluginGoogleAuth());
