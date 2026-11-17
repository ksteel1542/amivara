import 'package:flutter/material.dart';

import '../../theme/rose_tokens.g.dart';

enum LegalDoc { terms, privacy }

/// Plain-language Terms of Service and Privacy Policy, opened from the welcome
/// screen's consent checkbox. DRAFT (17 Nov 2026): written from what the app
/// actually does; to be reviewed by Nigerian counsel (NDPA 2023) before launch.
class LegalScreen extends StatelessWidget {
  const LegalScreen({super.key, required this.doc});

  final LegalDoc doc;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (title, sections) = doc == LegalDoc.terms ? ('Terms of Service', _terms) : ('Privacy Policy', _privacy);
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ListView(
        key: Key('legal-${doc.name}'),
        padding: const EdgeInsets.all(RoseSpacing.s4),
        children: <Widget>[
          Text('Last updated 17 November 2026', style: theme.textTheme.bodySmall),
          const SizedBox(height: RoseSpacing.s3),
          for (final (heading, body) in sections) ...<Widget>[
            Text(heading, style: theme.textTheme.titleMedium),
            const SizedBox(height: RoseSpacing.s1),
            Text(body, style: theme.textTheme.bodyMedium),
            const SizedBox(height: RoseSpacing.s4),
          ],
        ],
      ),
    );
  }
}

const List<(String, String)> _terms = <(String, String)>[
  (
    'Who can use AMIVARA',
    'AMIVARA is for adults only. You must be 18 or older and able to agree to these terms. '
        'We check your date of birth when you sign up, and members who verify with their NIN get a gold badge. '
        'Accounts we believe belong to someone under 18 are suspended at once.',
  ),
  (
    'Your account',
    'Keep your sign-in details to yourself. One account per person. Be truthful about who you are: '
        'fake profiles, impersonation and misleading photos are not allowed.',
  ),
  (
    'How to behave',
    'Follow the community guidelines. No harassment, threats, hate, explicit content nobody asked for, '
        'scams, or asking anyone for money, gifts or transport fare. Never pressure anyone to move off AMIVARA. '
        'You can block or report anyone at any time; we review every report.',
  ),
  (
    'Coins, gifts and paid features',
    'Coins are a virtual currency for paid messages, calls and gifts inside AMIVARA. They have no cash value '
        'for members and can\'t be transferred or refunded except where the law requires. Prices are shown before '
        'you pay. Your first paid call with a Verified Host includes a short free preview; after that, calls are '
        'charged per started minute.',
  ),
  (
    'Verified Hosts',
    'Verified Hosts are NIN-verified members who earn a share of the coins members buy and spend with them. '
        'Earnings are held for 7 days before they can be withdrawn to a bank account in the Host\'s name. '
        'We may hold or withhold earnings linked to fraud, chargebacks or rule breaking.',
  ),
  (
    'AI Companions',
    'AI Companions are clearly labelled AI characters, not real people. They never pretend to be human.',
  ),
  (
    'Live rooms and calls',
    'Calls and Chat House rooms are live and never recorded by AMIVARA. Don\'t record others without their consent.',
  ),
  (
    'Ending your account',
    'You can delete your account in Settings. We may suspend or close accounts that break these terms.',
  ),
  ('Contact', 'Questions or complaints: support@amivara.com.'),
];

const List<(String, String)> _privacy = <(String, String)>[
  (
    'What we collect',
    'Your email or phone number, date of birth, the profile you write, your photos, your approximate location '
        '(for discovery), your messages, and how you use the app. If you verify, your NIN check result (pass or fail '
        'and your verified age) — never your ID images or full NIN.',
  ),
  (
    'How we protect it',
    'Messages are encrypted at rest. Distances are shown rounded, never your exact location. '
        'Notifications never show names, photos or message text. Bank account numbers for Host payouts are encrypted.',
  ),
  (
    'Who we share it with',
    'Only the services that make AMIVARA work: Smile ID (identity checks), Paystack (payments and Host payouts), '
        'OpenAI (AI Companion replies: only the conversation, never your name or profile), LiveKit (call audio and video, '
        'not recorded), Firebase (notifications) and our cloud host (AWS, Cape Town). We never sell your data.',
  ),
  (
    'Your choices',
    'Pause or hide your profile, turn off live call invites, block or report anyone, download your data, '
        'or delete your account in Settings. Deleted accounts are erased after 30 days, except records we must keep by law.',
  ),
  (
    'Your rights',
    'Under the Nigeria Data Protection Act 2023 you can ask to see, correct or delete your data. '
        'Contact privacy@amivara.com.',
  ),
];
