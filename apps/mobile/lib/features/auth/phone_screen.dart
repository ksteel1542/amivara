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

/// Screen 2a: "What's your number?" (docs/UI_WIREFRAMES.md).
class PhoneScreen extends ConsumerStatefulWidget {
  const PhoneScreen({super.key});

  @override
  ConsumerState<PhoneScreen> createState() => _PhoneScreenState();
}

class _PhoneScreenState extends ConsumerState<PhoneScreen> {
  final _controller = TextEditingController();
  OtpChannel _channel = OtpChannel.sms;
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  String? get _e164 => NigerianPhone.toE164(_controller.text);

  Future<void> _send() async {
    final phone = _e164;
    if (phone == null || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final challenge = await ref.read(authRepositoryProvider).requestOtp(phone, _channel);
      ref.read(signupFlowProvider.notifier).codeSent(phone, challenge);
      if (mounted) context.push('/otp');
    } on ApiException catch (e) {
      setState(() => _error = _messageFor(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  static String _messageFor(ApiException e) => switch (e.code) {
    'OTP_RATE_LIMITED' || 'OTP_LOCKED' => 'Too many tries. Please wait ${_duration(e.retryAfter ?? 60)}.',
    'INVALID_PHONE' => 'Enter a valid Nigerian mobile number.',
    _ => e.message,
  };

  static String _duration(int seconds) {
    final m = seconds ~/ 60;
    final s = (seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return OnboardingScaffold(
      step: 1,
      title: "What's your number?",
      subtitle: "We'll text you a code to make sure it's really you.",
      primaryLabel: 'Send code',
      primaryBusy: _sending,
      onPrimary: _e164 == null ? null : _send,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Container(
              height: 56,
              padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s3),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                border: Border.all(color: theme.colorScheme.outline),
                borderRadius: BorderRadius.circular(RoseRadius.sm),
              ),
              child: Text('🇳🇬 +234', style: theme.textTheme.bodyLarge),
            ),
            const SizedBox(width: RoseSpacing.s2),
            Expanded(
              child: TextField(
                key: const Key('phone-field'),
                controller: _controller,
                autofocus: true,
                keyboardType: TextInputType.phone,
                autofillHints: const <String>[AutofillHints.telephoneNumberNational],
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.allow(RegExp(r'[\d +]')),
                  LengthLimitingTextInputFormatter(17),
                ],
                decoration: const InputDecoration(hintText: '801 234 5678', labelText: 'Mobile number'),
                onChanged: (_) => setState(() => _error = null),
                onSubmitted: (_) => _send(),
              ),
            ),
          ],
        ),
        const SizedBox(height: RoseSpacing.s6),
        Text('Send code via', style: theme.textTheme.labelLarge),
        const SizedBox(height: RoseSpacing.s2),
        SegmentedButton<OtpChannel>(
          segments: const <ButtonSegment<OtpChannel>>[
            ButtonSegment(value: OtpChannel.sms, label: Text('SMS'), icon: Icon(Icons.sms_outlined)),
            ButtonSegment(value: OtpChannel.whatsapp, label: Text('WhatsApp'), icon: Icon(Icons.chat_outlined)),
          ],
          selected: <OtpChannel>{_channel},
          onSelectionChanged: (s) => setState(() => _channel = s.first),
        ),
        const SizedBox(height: RoseSpacing.s4),
        Row(
          children: <Widget>[
            Icon(Icons.lock_outline, size: 16, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(width: RoseSpacing.s2),
            Expanded(
              child: Text(
                'Your number is never shown on your profile.',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
          ],
        ),
        if (_error != null) ...<Widget>[const SizedBox(height: RoseSpacing.s4), ErrorBanner(message: _error!)],
      ],
    );
  }
}
