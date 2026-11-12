import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import '../home/home_screen.dart';
import '../safety/report_user_sheet.dart';
import 'discovery_models.dart';
import 'discovery_providers.dart';
import 'profile_card.dart';

/// Another member's full profile (GET /profiles/:userId), opened from a discovery
/// card or a chat. Pops with a [SafetyOutcome] if they were reported or blocked
/// here, so the caller can drop the card or close the chat.
class MemberProfileScreen extends ConsumerStatefulWidget {
  const MemberProfileScreen({super.key, required this.userId});

  final String userId;

  @override
  ConsumerState<MemberProfileScreen> createState() => _MemberProfileScreenState();
}

class _MemberProfileScreenState extends ConsumerState<MemberProfileScreen> {
  DiscoveryCard? _card;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final card = await ref
          .read(discoveryRepositoryProvider)
          .viewProfile(ref.read(sessionProvider)!.accessToken, widget.userId);
      if (mounted) setState(() => _card = card);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.statusCode == 404 ? 'This profile is no longer available.' : e.message);
    }
  }

  Future<void> _safety() async {
    final card = _card;
    if (card == null) return;
    final outcome = await showSafetyMenu(context, userId: card.userId, firstName: card.firstName);
    if (outcome != null && mounted) context.pop(outcome);
  }

  @override
  Widget build(BuildContext context) {
    final card = _card;
    return Scaffold(
      appBar: AppBar(
        title: Text(card == null ? '' : '${card.firstName}, ${card.age}'),
        actions: <Widget>[
          if (card != null)
            IconButton(
              key: const Key('member-safety-menu'),
              tooltip: 'Safety & Report',
              icon: const Icon(Icons.shield_outlined),
              onPressed: _safety,
            ),
        ],
      ),
      body: card != null
          ? Padding(
              padding: const EdgeInsets.fromLTRB(RoseSpacing.s3, RoseSpacing.s2, RoseSpacing.s3, RoseSpacing.s3),
              child: ProfileCard(
                key: const Key('member-profile'),
                card: card,
                imageBuilder: ref.watch(cardImageBuilderProvider),
              ),
            )
          : Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Padding(
                      padding: const EdgeInsets.all(RoseSpacing.s8),
                      child: Text(_error!, key: const Key('member-error'), textAlign: TextAlign.center),
                    ),
            ),
    );
  }
}
