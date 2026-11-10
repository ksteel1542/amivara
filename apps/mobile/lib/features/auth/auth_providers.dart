import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/secure_store.dart';
import 'auth_repository.dart';

/// Overridden in main.dart (real HTTP + Keystore) and in tests (fakes).
final authRepositoryProvider = Provider<AuthRepository>((ref) => throw UnimplementedError('override in main'));
final secureStoreProvider = Provider<SecureStore>((ref) => throw UnimplementedError('override in main'));

/// In-progress sign-up / sign-in (phone → code → date of birth → basics).
class SignupState {
  const SignupState({this.phoneE164, this.challenge, this.signupToken, this.dateOfBirth});

  final String? phoneE164;
  final OtpChallenge? challenge;
  final String? signupToken;

  /// YYYY-MM-DD, confirmed by the member on Screen 3.
  final String? dateOfBirth;

  SignupState copyWith({String? phoneE164, OtpChallenge? challenge, String? signupToken, String? dateOfBirth}) =>
      SignupState(
        phoneE164: phoneE164 ?? this.phoneE164,
        challenge: challenge ?? this.challenge,
        signupToken: signupToken ?? this.signupToken,
        dateOfBirth: dateOfBirth ?? this.dateOfBirth,
      );
}

class SignupFlow extends Notifier<SignupState> {
  @override
  SignupState build() => const SignupState();

  void codeSent(String phoneE164, OtpChallenge challenge) =>
      state = SignupState(phoneE164: phoneE164, challenge: challenge);

  void phoneVerified(String signupToken) => state = state.copyWith(signupToken: signupToken);

  void dateOfBirthConfirmed(String dateOfBirth) => state = state.copyWith(dateOfBirth: dateOfBirth);

  void reset() => state = const SignupState();
}

final signupFlowProvider = NotifierProvider<SignupFlow, SignupState>(SignupFlow.new);

/// The signed-in session. The access token lives in memory only; the refresh
/// token is persisted in secure storage so the member stays signed in.
class Session extends Notifier<TokenPair?> {
  @override
  TokenPair? build() => null;

  Future<void> signIn(TokenPair tokens) async {
    await ref.read(secureStoreProvider).write(StoreKeys.refreshToken, tokens.refreshToken);
    state = tokens;
  }

  /// Startup: exchanges a stored refresh token for a new session.
  /// A rejected token is deleted; a network problem keeps it for next launch.
  /// Capped at a few seconds so an offline start never hangs on the splash screen.
  Future<bool> restore({Duration timeout = const Duration(seconds: 4)}) async {
    final store = ref.read(secureStoreProvider);
    final refresh = await store.read(StoreKeys.refreshToken);
    if (refresh == null) return false;
    try {
      await signIn(await ref.read(authRepositoryProvider).refresh(refresh).timeout(timeout));
      return true;
    } on ApiException catch (e) {
      if (!e.isNetwork) await store.delete(StoreKeys.refreshToken);
      return false;
    } on TimeoutException {
      return false;
    }
  }

  Future<void> signOut() async {
    await ref.read(secureStoreProvider).delete(StoreKeys.refreshToken);
    state = null;
  }
}

final sessionProvider = NotifierProvider<Session, TokenPair?>(Session.new);
