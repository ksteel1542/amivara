import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import '../home/home_screen.dart';

/// Community conduct, shown once right after sign-up and before discovery
/// (and once to existing members). Accepting is recorded on the server.
class GuidelinesScreen extends ConsumerStatefulWidget {
  const GuidelinesScreen({super.key});

  static const List<(IconData, String, String)> rules = <(IconData, String, String)>[
    (Icons.eighteen_up_rating_outlined, '18+ only', 'AMIVARA is for adults. Report anyone you think is under 18.'),
    (Icons.no_adult_content_outlined, 'No nudity', 'No sexual or explicit photos or messages, ever.'),
    (Icons.money_off_rounded, 'No scams', 'Never send money, airtime or gifts to someone you met here.'),
    (
      Icons.chat_outlined,
      'Keep chats in AMIVARA',
      "Don't rush to WhatsApp or Telegram. Our safety tools only work here.",
    ),
    (Icons.favorite_border_rounded, 'Be respectful', 'No harassment, hate or pressure. "No" means no.'),
  ];

  @override
  ConsumerState<GuidelinesScreen> createState() => _GuidelinesScreenState();
}

class _GuidelinesScreenState extends ConsumerState<GuidelinesScreen> {
  bool _saving = false;

  Future<void> _accept() async {
    setState(() => _saving = true);
    try {
      await ref.read(authRepositoryProvider).acceptGuidelines(ref.read(sessionProvider)!.accessToken);
      ref.invalidate(currentMemberProvider);
      if (mounted) context.go('/home');
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          key: const Key('guidelines'),
          padding: const EdgeInsets.fromLTRB(
            RoseSpacing.gutterOnboarding,
            RoseSpacing.s8,
            RoseSpacing.gutterOnboarding,
            RoseSpacing.buttonBottomInset,
          ),
          children: <Widget>[
            Text(
              'Our community guidelines',
              style: theme.textTheme.headlineLarge?.copyWith(color: theme.colorScheme.secondary),
            ),
            const SizedBox(height: RoseSpacing.s2),
            Text(
              'AMIVARA works because everyone agrees to these. Breaking them can get you banned.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: RoseSpacing.s4),
            for (final (icon, title, body) in GuidelinesScreen.rules)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(icon, color: theme.colorScheme.primary),
                title: Text(title, style: theme.textTheme.titleMedium),
                subtitle: Text(body),
              ),
            const SizedBox(height: RoseSpacing.s6),
            SizedBox(
              height: RoseSpacing.buttonPrimaryHeight,
              child: FilledButton(
                key: const Key('accept-guidelines'),
                onPressed: _saving ? null : _accept,
                child: _saving
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('I agree'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
