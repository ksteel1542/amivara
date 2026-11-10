import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/secure_screen.dart';
import '../../theme/rose_tokens.g.dart';
import '../../widgets/onboarding_scaffold.dart';
import '../auth/auth_providers.dart';
import 'verification_providers.dart';

/// Screen 5c: NIN entry for Smile ID Biometric KYC (docs/UI_WIREFRAMES.md).
/// FLAG_SECURE blocks screenshots while the NIN is on screen; the number goes
/// only to the Smile ID SDK, never to our API.
class NinScreen extends ConsumerStatefulWidget {
  const NinScreen({super.key});

  @override
  ConsumerState<NinScreen> createState() => _NinScreenState();
}

class _NinScreenState extends ConsumerState<NinScreen> {
  final _nin = TextEditingController();
  bool _consent = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    SecureScreen.enable();
  }

  @override
  void dispose() {
    SecureScreen.disable();
    _nin.dispose();
    super.dispose();
  }

  String get _digits => _nin.text.replaceAll(RegExp(r'\D'), '');
  bool get _valid => _digits.length == 11 && _consent;

  Future<void> _start() async {
    if (!_valid || _busy) return;
    if (!ref.read(identityCaptureProvider).available) {
      setState(() => _error = "Identity verification isn't available in this version of the app yet.");
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final token = ref.read(sessionProvider)!.accessToken;
      final ticket = await ref.read(verificationRepositoryProvider).startSession(token);
      ref.read(verificationFlowProvider.notifier).ready(ticket, _digits, DateTime.now());
      if (mounted) context.push('/verify/capture');
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'ALREADY_VERIFIED') {
        context.go('/verify/result?status=passed');
        return;
      }
      if (e.code == 'UNDER_REVIEW') {
        context.go('/verify/result?status=manual_review');
        return;
      }
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _whereIsMyNin() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => const SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(RoseSpacing.s6, 0, RoseSpacing.s6, RoseSpacing.s6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text('Finding your NIN'),
              SizedBox(height: RoseSpacing.s3),
              Text('• Dial *346# from the phone number linked to your NIN.'),
              Text('• Open the NIMC MWS app.'),
              Text('• Check your NIN slip or National ID card.'),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return OnboardingScaffold(
      step: 5,
      title: 'Enter your NIN',
      subtitle: 'The 11-digit number on your NIN slip or in the NIMC app.',
      primaryLabel: 'Verify my identity',
      primaryBusy: _busy,
      onPrimary: _valid ? _start : null,
      children: <Widget>[
        TextField(
          key: const Key('nin-field'),
          controller: _nin,
          keyboardType: TextInputType.number,
          autofillHints: const <String>[],
          enableSuggestions: false,
          autocorrect: false,
          inputFormatters: <TextInputFormatter>[
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(11),
          ],
          decoration: const InputDecoration(labelText: 'NIN', hintText: '12345678901'),
          onChanged: (_) => setState(() => _error = null),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(onPressed: _whereIsMyNin, child: const Text('Where do I find my NIN? ›')),
        ),
        const SizedBox(height: RoseSpacing.s2),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.lock_outline, size: 16, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(width: RoseSpacing.s2),
            Expanded(
              child: Text(
                "Checked securely with NIMC through Smile ID. We don't store your NIN.",
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
          ],
        ),
        const SizedBox(height: RoseSpacing.s4),
        CheckboxListTile(
          key: const Key('nin-consent'),
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          value: _consent,
          onChanged: (v) => setState(() => _consent = v ?? false),
          title: Text(
            'I agree to Smile ID checking my NIN and selfie with NIMC to confirm my identity and age.',
            style: theme.textTheme.bodyMedium,
          ),
        ),
        const SizedBox(height: RoseSpacing.s2),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(RoseSpacing.s4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Next: a quick selfie', style: theme.textTheme.titleMedium),
                const SizedBox(height: RoseSpacing.s1),
                const Text(
                  "We'll ask for your camera once, for a live selfie check. It isn't saved to your gallery. "
                  'Find good light, remove glasses and cap, and face the camera.',
                ),
              ],
            ),
          ),
        ),
        if (_error != null) ...<Widget>[const SizedBox(height: RoseSpacing.s4), ErrorBanner(message: _error!)],
      ],
    );
  }
}
