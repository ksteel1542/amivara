import 'package:flutter/material.dart';

import '../../theme/rose_tokens.g.dart';
import 'discovery_models.dart';

typedef CardImageBuilder = Widget Function(BuildContext context, String url);

Widget networkCardImage(BuildContext context, String url) => Image.network(
  url,
  fit: BoxFit.cover,
  errorBuilder: (context, error, stack) => const ColoredBox(color: Colors.black26),
);

const Map<String, String> _intentLabels = <String, String>{
  'relationship': 'Looking for a relationship',
  'friendship': 'Looking for friendship',
  'casual': 'Something casual',
  'not_sure': 'Not sure yet',
};

/// One discovery card: a full-height photo carousel (tap left/right to change
/// photo) with name, age, the gold verified badge and the coarse distance,
/// then bio, prompts and interests below (scroll inside the card).
class ProfileCard extends StatefulWidget {
  const ProfileCard({super.key, required this.card, this.imageBuilder = networkCardImage});

  final DiscoveryCard card;
  final CardImageBuilder imageBuilder;

  @override
  State<ProfileCard> createState() => _ProfileCardState();
}

class _ProfileCardState extends State<ProfileCard> {
  int _photo = 0;

  void _step(int delta) {
    final count = widget.card.photoUrls.length;
    if (count < 2) return;
    setState(() => _photo = (_photo + delta).clamp(0, count - 1));
  }

  @override
  Widget build(BuildContext context) {
    final card = widget.card;
    final theme = Theme.of(context);

    return ClipRRect(
      borderRadius: BorderRadius.circular(RoseRadius.lg),
      child: ColoredBox(
        color: theme.colorScheme.surfaceContainer,
        child: LayoutBuilder(
          builder: (context, constraints) => ListView(
            padding: EdgeInsets.zero,
            children: <Widget>[
              SizedBox(
                height: constraints.maxHeight * 0.78,
                child: GestureDetector(
                  onTapUp: (details) => _step(details.localPosition.dx < constraints.maxWidth / 2 ? -1 : 1),
                  child: Stack(
                    fit: StackFit.expand,
                    children: <Widget>[
                      if (card.photoUrls.isNotEmpty)
                        KeyedSubtree(
                          key: ValueKey<String>('photo-$_photo'),
                          child: widget.imageBuilder(context, card.photoUrls[_photo]),
                        ),
                      const DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.center,
                            end: Alignment.bottomCenter,
                            colors: <Color>[Colors.transparent, Color(0xCC1A0B12)],
                          ),
                        ),
                      ),
                      if (card.photoUrls.length > 1)
                        Positioned(
                          top: RoseSpacing.s2,
                          left: RoseSpacing.s2,
                          right: RoseSpacing.s2,
                          child: Row(
                            children: <Widget>[
                              for (var i = 0; i < card.photoUrls.length; i++)
                                Expanded(
                                  child: Container(
                                    height: 3,
                                    margin: const EdgeInsets.symmetric(horizontal: 2),
                                    decoration: BoxDecoration(
                                      color: i == _photo ? Colors.white : Colors.white38,
                                      borderRadius: BorderRadius.circular(2),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      Positioned(
                        left: RoseSpacing.s4,
                        right: RoseSpacing.s4,
                        bottom: RoseSpacing.s4,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Row(
                              children: <Widget>[
                                Flexible(
                                  child: Text(
                                    '${card.firstName}, ${card.age}',
                                    style: theme.textTheme.headlineMedium?.copyWith(color: RoseColors.warmIvory),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                if (card.verified) ...<Widget>[
                                  const SizedBox(width: RoseSpacing.s2),
                                  const VerifiedBadge(),
                                ],
                              ],
                            ),
                            const SizedBox(height: RoseSpacing.s1),
                            Row(
                              children: <Widget>[
                                const Icon(Icons.place_outlined, size: 16, color: RoseColors.warmIvory),
                                const SizedBox(width: RoseSpacing.s1),
                                Text(
                                  card.distanceLabel,
                                  style: theme.textTheme.bodyMedium?.copyWith(color: RoseColors.warmIvory),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(RoseSpacing.s4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    if (card.intent != null && _intentLabels[card.intent] != null)
                      Chip(
                        avatar: Icon(Icons.favorite_border, size: 16, color: theme.colorScheme.primary),
                        label: Text(_intentLabels[card.intent]!),
                      ),
                    if (card.bio != null) ...<Widget>[
                      const SizedBox(height: RoseSpacing.s3),
                      Text(card.bio!, style: theme.textTheme.bodyLarge),
                    ],
                    for (final p in card.prompts) ...<Widget>[
                      const SizedBox(height: RoseSpacing.s3),
                      Card(
                        color: theme.colorScheme.surface,
                        child: Padding(
                          padding: const EdgeInsets.all(RoseSpacing.s4),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(p.prompt, style: theme.textTheme.labelLarge),
                              const SizedBox(height: RoseSpacing.s1),
                              Text(p.answer, style: theme.textTheme.headlineSmall),
                            ],
                          ),
                        ),
                      ),
                    ],
                    if (card.interests.isNotEmpty) ...<Widget>[
                      const SizedBox(height: RoseSpacing.s3),
                      Wrap(
                        spacing: RoseSpacing.s2,
                        runSpacing: RoseSpacing.s2,
                        children: <Widget>[for (final i in card.interests) Chip(label: Text(i))],
                      ),
                    ],
                    const SizedBox(height: RoseSpacing.s16),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The AMIVARA ROSE verified badge: gold rosette, night check (9.07:1). Reserved for Smile ID-verified members.
class VerifiedBadge extends StatelessWidget {
  const VerifiedBadge({super.key, this.size = 24});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Verified',
      child: Container(
        key: const Key('verified-badge-icon'),
        width: size,
        height: size,
        decoration: const BoxDecoration(color: RoseColors.champagneGold, shape: BoxShape.circle),
        child: Icon(Icons.check_rounded, size: size * 0.7, color: RoseColors.burgundyBlack),
      ),
    );
  }
}
