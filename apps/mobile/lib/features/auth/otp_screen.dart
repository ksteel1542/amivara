import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../../widgets/onboarding_scaffold.dart';
import 'auth_providers.dart';
import 'auth_repository.dart';
import 'nigerian_phone.dart';

/// Screen 2b: "Enter your code" (docs/UI_WIREFRAMES.md).
class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({super.key});

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  static const int codeLength = 6;

  final _controller = TextEditingController();
  final _focus = FocusNode();
  Timer? _ticker;
  int _resendIn = 0;
  int _resends = 0;
  bool _busy = false;
  bool _locked = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _startCountdown(ref.read(signupFlowProvider).challenge?.resendIn ?? 60);
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _startCountdown(int seconds) {
    _ticker?.cancel();
    setState(() => _resendIn = seconds);
    _ticker = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _resendIn = (_resendIn - 1).clamp(0, 9999));
      if (_resendIn == 0) t.cancel();
    });
  }

  Future<void> _verify() async {
    final flow = ref.read(signupFlowProvider);
    final challenge = flow.challenge;
    if (challenge == null || _busy || _locked || _controller.text.length != codeLength) return;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await ref.read(authRepositoryProvider).verifyOtp(challenge.challengeId, _controller.text);
      if (!mounted) return;
      switch (result) {
        case SignedIn(:final tokens):
          await ref.read(sessionProvider.notifier).signIn(tokens);
          ref.read(signupFlowProvider.notifier).reset();
          if (mounted) context.go('/home');
        case SignupRequired(:final signupToken):
          ref.read(signupFlowProvider.notifier).phoneVerified(signupToken);
          context.go('/dob');
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      _controller.clear();
      setState(() {
        _locked = e.code == 'OTP_LOCKED';
        _error = switch (e.code) {
          'OTP_INVALID' => switch ((e.details['attempts_left'] as num?)?.toInt()) {
            final int left => "That code isn't right. $left ${left == 1 ? 'try' : 'tries'} left.",
            null => "That code isn't right.",
          },
          'OTP_EXPIRED' => 'That code has expired. Tap "Resend code" for a new one.',
          'OTP_LOCKED' => 'Too many wrong codes. Please wait a few minutes, then request a new code.',
          'SIGNUP_BLOCKED' => "You can't create an account right now.",
          'ACCOUNT_SUSPENDED' => 'This account is not active.',
          _ => e.message,
        };
      });
      _focus.requestFocus();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend(OtpChannel channel) async {
    final phone = ref.read(signupFlowProvider).phoneE164;
    if (phone == null || _resendIn > 0) return;
    try {
      final challenge = await ref.read(authRepositoryProvider).requestOtp(phone, channel);
      ref.read(signupFlowProvider.notifier).codeSent(phone, challenge);
      _controller.clear();
      setState(() {
        _resends++;
        _locked = false;
        _error = null;
      });
      _startCountdown(challenge.resendIn);
    } on ApiException catch (e) {
      setState(
        () => _error = e.code == 'OTP_RATE_LIMITED' || e.code == 'OTP_LOCKED'
            ? 'Too many tries. Please wait before requesting another code.'
            : e.message,
      );
      if (e.retryAfter != null) _startCountdown(e.retryAfter!);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final flow = ref.watch(signupFlowProvider);
    final channel = flow.challenge?.channel == OtpChannel.whatsapp ? 'WhatsApp' : 'SMS';
    final phone = flow.phoneE164 == null ? '' : '+234 ${NigerianPhone.format(flow.phoneE164!)}';

    return OnboardingScaffold(
      step: 2,
      title: 'Enter your code',
      subtitle: 'Sent by $channel to $phone',
      primaryLabel: 'Verify',
      primaryBusy: _busy,
      onPrimary: _controller.text.length == codeLength && !_locked ? _verify : null,
      children: <Widget>[
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(onPressed: () => context.pop(), child: const Text('Change number')),
        ),
        const SizedBox(height: RoseSpacing.s4),
        _CodeBoxes(
          controller: _controller,
          focusNode: _focus,
          length: codeLength,
          enabled: !_locked,
          hasError: _error != null,
          onChanged: (value) {
            setState(() => _error = null);
            if (value.length == codeLength) _verify();
          },
        ),
        if (_error != null) ...<Widget>[const SizedBox(height: RoseSpacing.s4), ErrorBanner(message: _error!)],
        const SizedBox(height: RoseSpacing.s6),
        if (_resendIn > 0)
          Text(
            'Resend code in ${_resendIn ~/ 60}:${(_resendIn % 60).toString().padLeft(2, '0')}',
            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          )
        else
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => _resend(flow.challenge?.channel ?? OtpChannel.sms),
              child: const Text('Resend code'),
            ),
          ),
        if (_resends > 0 && flow.challenge?.channel != OtpChannel.whatsapp)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: _resendIn > 0 ? null : () => _resend(OtpChannel.whatsapp),
              child: const Text("Didn't get it? Try WhatsApp"),
            ),
          ),
      ],
    );
  }
}

/// Six visual boxes over one invisible text field, so system SMS autofill
/// (AutofillHints.oneTimeCode) and paste fill the whole code at once.
class _CodeBoxes extends StatelessWidget {
  const _CodeBoxes({
    required this.controller,
    required this.focusNode,
    required this.length,
    required this.enabled,
    required this.hasError,
    required this.onChanged,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final int length;
  final bool enabled;
  final bool hasError;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Stack(
      children: <Widget>[
        ValueListenableBuilder<TextEditingValue>(
          valueListenable: controller,
          builder: (context, value, _) {
            return Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: List<Widget>.generate(length, (i) {
                final filled = i < value.text.length;
                final focused = focusNode.hasFocus && i == value.text.length;
                final color = hasError
                    ? theme.colorScheme.error
                    : focused
                    ? theme.colorScheme.primary
                    : theme.colorScheme.outline;
                return Container(
                  width: 46,
                  height: 56,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainer,
                    borderRadius: BorderRadius.circular(RoseRadius.sm),
                    border: Border.all(color: color, width: focused || hasError ? 2 : 1),
                  ),
                  child: Text(filled ? value.text[i] : '', style: theme.textTheme.headlineSmall),
                );
              }),
            );
          },
        ),
        Positioned.fill(
          child: Opacity(
            opacity: 0.01,
            child: TextField(
              key: const Key('otp-field'),
              controller: controller,
              focusNode: focusNode,
              enabled: enabled,
              autofocus: true,
              keyboardType: TextInputType.number,
              autofillHints: const <String>[AutofillHints.oneTimeCode],
              inputFormatters: <TextInputFormatter>[
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(length),
              ],
              showCursor: false,
              decoration: const InputDecoration(border: InputBorder.none, counterText: ''),
              onChanged: onChanged,
            ),
          ),
        ),
      ],
    );
  }
}
