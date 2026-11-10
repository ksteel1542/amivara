import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../../widgets/onboarding_scaffold.dart';
import '../auth/auth_providers.dart';
import 'age.dart';

const List<String> _months = <String>[
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/// Screen 3: 18+ age gate (docs/UI_WIREFRAMES.md).
///
/// Three fields instead of the Material date picker, which opens on today's
/// date and nudges careless entry. Nothing here suggests a "right" year, and
/// an under-18 answer goes straight to Screen 3x with no way back.
class DobScreen extends ConsumerStatefulWidget {
  const DobScreen({super.key});

  @override
  ConsumerState<DobScreen> createState() => _DobScreenState();
}

class _DobScreenState extends ConsumerState<DobScreen> {
  final _day = TextEditingController();
  final _year = TextEditingController();
  int? _month;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _day.dispose();
    _year.dispose();
    super.dispose();
  }

  DateTime? get _birth {
    final day = int.tryParse(_day.text);
    final year = int.tryParse(_year.text);
    if (day == null || year == null || _month == null || _year.text.length != 4) return null;
    return AgeRules.date(year, _month!, day);
  }

  Future<void> _continue() async {
    final birth = _birth;
    if (birth == null) {
      setState(() => _error = 'Enter a real date of birth.');
      return;
    }
    final age = AgeRules.currentAge(birth);
    if (age < 0 || age > AgeRules.maximumAge) {
      setState(() => _error = 'Check the year of your birth.');
      return;
    }

    // Under 18: still tell the server (it blocks this phone and device), then close the door.
    if (age < AgeRules.minimumAge) {
      await _submit(birth, underageExpected: true);
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text("You're $age", style: Theme.of(context).textTheme.headlineSmall),
        content: Text(
          'Born ${birth.day} ${_months[birth.month - 1]} ${birth.year}. '
          "You'll confirm this with your ID later, and you can't change it afterwards.",
        ),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Edit')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Confirm')),
        ],
      ),
    );
    if (confirmed == true) await _submit(birth, underageExpected: false);
  }

  Future<void> _submit(DateTime birth, {required bool underageExpected}) async {
    final token = ref.read(signupFlowProvider).signupToken;
    if (token == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authRepositoryProvider).ageGate(token, AgeRules.iso(birth));
      if (!mounted) return;
      if (underageExpected) {
        // The server should have refused; never let a mismatch open the door.
        context.go('/not-eligible');
        return;
      }
      ref.read(signupFlowProvider.notifier).dateOfBirthConfirmed(AgeRules.iso(birth));
      context.go('/basics');
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'UNDERAGE' || e.code == 'SIGNUP_BLOCKED' || underageExpected) {
        context.go('/not-eligible');
        return;
      }
      setState(() => _error = e.code == 'INVALID_TOKEN' ? 'This sign-up has expired. Please start again.' : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return OnboardingScaffold(
      step: 3,
      title: "When's your birthday?",
      subtitle: "AMIVARA is for adults 18 and over. Your age shows on your profile, but your birthday doesn't.",
      primaryLabel: 'Continue',
      primaryBusy: _busy,
      onPrimary: _birth == null ? null : _continue,
      showBack: false,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            SizedBox(
              width: 72,
              child: TextField(
                key: const Key('dob-day'),
                controller: _day,
                keyboardType: TextInputType.number,
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(2),
                ],
                decoration: const InputDecoration(labelText: 'Day', hintText: 'DD'),
                onChanged: (_) => setState(() => _error = null),
              ),
            ),
            const SizedBox(width: RoseSpacing.s2),
            Expanded(
              child: DropdownButtonFormField<int>(
                key: const Key('dob-month'),
                initialValue: _month,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Month'),
                items: <DropdownMenuItem<int>>[
                  for (var i = 0; i < 12; i++) DropdownMenuItem<int>(value: i + 1, child: Text(_months[i])),
                ],
                onChanged: (m) => setState(() {
                  _month = m;
                  _error = null;
                }),
              ),
            ),
            const SizedBox(width: RoseSpacing.s2),
            SizedBox(
              width: 92,
              child: TextField(
                key: const Key('dob-year'),
                controller: _year,
                keyboardType: TextInputType.number,
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(4),
                ],
                decoration: const InputDecoration(labelText: 'Year', hintText: 'YYYY'),
                onChanged: (_) => setState(() => _error = null),
              ),
            ),
          ],
        ),
        const SizedBox(height: RoseSpacing.s4),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.info_outline, size: 18, color: theme.colorScheme.tertiary),
            const SizedBox(width: RoseSpacing.s2),
            Expanded(
              child: Text(
                "You'll confirm this with your ID in a later step, so make sure it matches.",
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
