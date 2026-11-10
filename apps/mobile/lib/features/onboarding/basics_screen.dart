import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../../widgets/onboarding_scaffold.dart';
import '../auth/auth_providers.dart';
import '../auth/auth_repository.dart';

const Map<Gender, String> _genderLabels = <Gender, String>{
  Gender.woman: 'Woman',
  Gender.man: 'Man',
  Gender.nonBinary: 'Non-binary',
};

const Map<Gender, String> _interestLabels = <Gender, String>{
  Gender.woman: 'Women',
  Gender.man: 'Men',
  Gender.nonBinary: 'Non-binary people',
};

const Map<DatingIntent, String> _intentLabels = <DatingIntent, String>{
  DatingIntent.relationship: 'A relationship',
  DatingIntent.friendship: 'Friendship',
  DatingIntent.casual: 'Something casual',
  DatingIntent.notSure: 'Not sure yet',
};

/// Profile basics (PRD §5.1 step 3): first name, gender, who you're interested in, intent.
/// Submitting creates the account. Photos and Smile ID verification follow.
class BasicsScreen extends ConsumerStatefulWidget {
  const BasicsScreen({super.key});

  @override
  ConsumerState<BasicsScreen> createState() => _BasicsScreenState();
}

class _BasicsScreenState extends ConsumerState<BasicsScreen> {
  final _name = TextEditingController();
  Gender? _gender;
  final Set<Gender> _interestedIn = <Gender>{};
  DatingIntent? _intent;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  bool get _valid => _name.text.trim().isNotEmpty && _gender != null && _interestedIn.isNotEmpty && _intent != null;

  Future<void> _submit() async {
    final flow = ref.read(signupFlowProvider);
    if (!_valid || flow.signupToken == null || flow.dateOfBirth == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final tokens = await ref
          .read(authRepositoryProvider)
          .completeOnboarding(
            flow.signupToken!,
            OnboardingDetails(
              firstName: _name.text.trim(),
              dateOfBirth: flow.dateOfBirth!,
              gender: _gender!,
              interestedIn: _interestedIn,
              intent: _intent!,
            ),
          );
      await ref.read(sessionProvider.notifier).signIn(tokens);
      ref.read(signupFlowProvider.notifier).reset();
      if (mounted) context.go('/home');
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'UNDERAGE' || e.code == 'SIGNUP_BLOCKED') {
        context.go('/not-eligible');
        return;
      }
      setState(
        () => _error = switch (e.code) {
          'PHONE_ALREADY_REGISTERED' => 'This number already has an account. Go back and sign in instead.',
          'INVALID_TOKEN' => 'This sign-up has expired. Please start again.',
          'VALIDATION_FAILED' => 'Check your first name: letters only.',
          _ => e.message,
        },
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Widget label(String text) => Padding(
      padding: const EdgeInsets.only(top: RoseSpacing.s6, bottom: RoseSpacing.s2),
      child: Text(text, style: theme.textTheme.titleMedium),
    );

    return OnboardingScaffold(
      step: 4,
      title: 'A little about you',
      subtitle: 'You can add photos, a bio and more next.',
      primaryLabel: 'Create my account',
      primaryBusy: _busy,
      onPrimary: _valid ? _submit : null,
      showBack: false,
      children: <Widget>[
        TextField(
          key: const Key('first-name'),
          controller: _name,
          textCapitalization: TextCapitalization.words,
          autofillHints: const <String>[AutofillHints.givenName],
          inputFormatters: <TextInputFormatter>[LengthLimitingTextInputFormatter(50)],
          decoration: const InputDecoration(labelText: 'First name', helperText: 'This is how you appear on AMIVARA.'),
          onChanged: (_) => setState(() => _error = null),
        ),
        label('I am a'),
        Wrap(
          spacing: RoseSpacing.s2,
          children: <Widget>[
            for (final g in Gender.values)
              ChoiceChip(
                label: Text(_genderLabels[g]!),
                selected: _gender == g,
                onSelected: (_) => setState(() => _gender = g),
              ),
          ],
        ),
        label("I'm interested in"),
        Wrap(
          spacing: RoseSpacing.s2,
          children: <Widget>[
            for (final g in Gender.values)
              FilterChip(
                label: Text(_interestLabels[g]!),
                selected: _interestedIn.contains(g),
                onSelected: (on) => setState(() => on ? _interestedIn.add(g) : _interestedIn.remove(g)),
              ),
          ],
        ),
        label("I'm looking for"),
        Wrap(
          spacing: RoseSpacing.s2,
          runSpacing: RoseSpacing.s2,
          children: <Widget>[
            for (final i in DatingIntent.values)
              ChoiceChip(
                label: Text(_intentLabels[i]!),
                selected: _intent == i,
                onSelected: (_) => setState(() => _intent = i),
              ),
          ],
        ),
        if (_error != null) ...<Widget>[const SizedBox(height: RoseSpacing.s6), ErrorBanner(message: _error!)],
      ],
    );
  }
}
