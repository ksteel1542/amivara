import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../../widgets/onboarding_scaffold.dart';
import 'auth_providers.dart';
import 'auth_repository.dart';
import 'google_auth.dart';

/// Screen 2a (email-first, Nov 2026): email code or Google Sign-In; phone is the optional fallback.
class EmailScreen extends ConsumerStatefulWidget {
  const EmailScreen({super.key});

  @override
  ConsumerState<EmailScreen> createState() => _EmailScreenState();
}

class _EmailScreenState extends ConsumerState<EmailScreen> {
  final _controller = TextEditingController();
  bool _sending = false;
  bool _google = false;
  String? _error;

  static final RegExp _email = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]{2,}$');

  String? get _value {
    final v = _controller.text.trim().toLowerCase();
    return _email.hasMatch(v) ? v : null;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final email = _value;
    if (email == null || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final challenge = await ref.read(authRepositoryProvider).requestEmailOtp(email);
      ref.read(signupFlowProvider.notifier).emailCodeSent(email, challenge);
      if (mounted) context.push('/otp');
    } on ApiException catch (e) {
      setState(() => _error = _messageFor(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _withGoogle() async {
    if (_google) return;
    setState(() {
      _google = true;
      _error = null;
    });
    try {
      final idToken = await ref.read(googleAuthProvider).idToken();
      if (idToken == null || !mounted) return; // cancelled
      final result = await ref.read(authRepositoryProvider).googleSignIn(idToken);
      if (!mounted) return;
      switch (result) {
        case SignedIn(:final tokens):
          await ref.read(sessionProvider.notifier).signIn(tokens);
          if (mounted) context.go('/home');
        case SignupRequired(:final signupToken):
          ref.read(signupFlowProvider.notifier).verified(signupToken);
          context.go('/dob');
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = _messageFor(e));
    } catch (_) {
      if (mounted) setState(() => _error = "Google sign-in didn't work. Use your email instead.");
    } finally {
      if (mounted) setState(() => _google = false);
    }
  }

  static String _messageFor(ApiException e) => switch (e.code) {
    'OTP_RATE_LIMITED' || 'OTP_LOCKED' => 'Too many tries. Please wait a moment and try again.',
    'INVALID_EMAIL' => 'Enter a valid email address.',
    'SIGNUP_BLOCKED' => "You can't create an account right now.",
    'ACCOUNT_SUSPENDED' => 'This account is not active.',
    _ => e.message,
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final google = ref.watch(googleAuthProvider);
    return OnboardingScaffold(
      step: 1,
      title: "What's your email?",
      subtitle: "We'll send you a 6-digit code to sign in. No password needed.",
      primaryLabel: 'Send code',
      primaryBusy: _sending,
      onPrimary: _value == null || _google ? null : _send,
      children: <Widget>[
        TextField(
          key: const Key('email-field'),
          controller: _controller,
          autofocus: true,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          autofillHints: const <String>[AutofillHints.email],
          textInputAction: TextInputAction.send,
          decoration: const InputDecoration(labelText: 'Email address', hintText: 'you@example.com'),
          onChanged: (_) => setState(() => _error = null),
          onSubmitted: (_) => _send(),
        ),
        const SizedBox(height: RoseSpacing.s3),
        Row(
          children: <Widget>[
            Icon(Icons.lock_outline, size: 16, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(width: RoseSpacing.s2),
            Expanded(
              child: Text(
                'Your email is never shown on your profile.',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
          ],
        ),
        if (google.available) ...<Widget>[
          const SizedBox(height: RoseSpacing.s6),
          Row(
            children: <Widget>[
              const Expanded(child: Divider()),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s3),
                child: Text('or', style: theme.textTheme.bodySmall),
              ),
              const Expanded(child: Divider()),
            ],
          ),
          const SizedBox(height: RoseSpacing.s4),
          OutlinedButton.icon(
            key: const Key('google-signin'),
            onPressed: _google || _sending ? null : _withGoogle,
            icon: _google
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.g_mobiledata_rounded, size: 28),
            label: const Text('Continue with Google'),
          ),
        ],
        const SizedBox(height: RoseSpacing.s2),
        Align(
          child: TextButton(
            key: const Key('use-phone'),
            onPressed: () => context.push('/phone'),
            child: const Text('Use phone number instead'),
          ),
        ),
        if (_error != null) ...<Widget>[const SizedBox(height: RoseSpacing.s4), ErrorBanner(message: _error!)],
      ],
    );
  }
}
