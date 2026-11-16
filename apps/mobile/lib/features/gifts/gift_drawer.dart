import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import '../wallet/topup_sheet.dart';
import 'gift_repository.dart';

/// The 1-tap gift flow for chats and rooms: pick a gift, it's sent, an animated
/// banner celebrates it. Not enough coins opens the top-up sheet, and the gift
/// goes as soon as the top-up lands. Returns the balance after, or null.
Future<int?> sendGiftFlow(
  BuildContext context,
  WidgetRef ref, {
  required String toName,
  required Future<int> Function(Gift gift, String idempotencyKey) send,
}) async {
  final gift = await showModalBottomSheet<Gift>(
    context: context,
    showDragHandle: true,
    useSafeArea: true,
    builder: (_) => GiftDrawer(toName: toName),
  );
  if (gift == null || !context.mounted) return null;
  final key = newGiftKey(); // the same key on the retry after a top-up: never charged twice
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      final balance = await send(gift, key);
      if (context.mounted) showGiftToast(context, gift: gift, toName: toName);
      return balance;
    } on ApiException catch (e) {
      if (!context.mounted) return null;
      if (e.code == 'INSUFFICIENT_COINS' && attempt == 0) {
        final balance = (e.details['balance'] as num?)?.toInt();
        final required = (e.details['required'] as num?)?.toInt() ?? gift.priceCoins;
        final topped = await showTopUpSheet(context, needed: balance == null ? null : required - balance);
        if (topped == null || topped.balance < gift.priceCoins || !context.mounted) return null;
        continue;
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      return null;
    }
  }
  return null;
}

/// The gift picker: Rose, Kiss, Teddy, Crown… with their prices.
class GiftDrawer extends ConsumerStatefulWidget {
  const GiftDrawer({super.key, required this.toName});

  final String toName;

  @override
  ConsumerState<GiftDrawer> createState() => _GiftDrawerState();
}

class _GiftDrawerState extends ConsumerState<GiftDrawer> {
  List<Gift>? _gifts;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final gifts = await ref.read(giftRepositoryProvider).catalogue(ref.read(sessionProvider)!.accessToken);
      if (mounted) setState(() => _gifts = gifts);
    } on Object {
      if (mounted) setState(() => _error = "Gifts couldn't load. Please try again.");
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final gifts = _gifts;
    return Padding(
      key: const Key('gift-drawer'),
      padding: const EdgeInsets.fromLTRB(RoseSpacing.s4, 0, RoseSpacing.s4, RoseSpacing.s6),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text('Send ${widget.toName} a gift', style: theme.textTheme.titleLarge, textAlign: TextAlign.center),
          const SizedBox(height: RoseSpacing.s1),
          Text(
            'Verified Hosts receive half of the bought coins you send.',
            style: theme.textTheme.bodySmall,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: RoseSpacing.s4),
          if (_error != null)
            Text(_error!, textAlign: TextAlign.center)
          else if (gifts == null)
            const Center(child: CircularProgressIndicator())
          else
            Wrap(
              alignment: WrapAlignment.center,
              spacing: RoseSpacing.s2,
              runSpacing: RoseSpacing.s2,
              children: <Widget>[for (final g in gifts) _GiftTile(gift: g)],
            ),
        ],
      ),
    );
  }
}

class _GiftTile extends StatelessWidget {
  const _GiftTile({required this.gift});

  final Gift gift;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      button: true,
      label: '${gift.name}, ${gift.priceCoins} coins',
      child: Material(
        color: theme.colorScheme.surfaceContainer,
        borderRadius: BorderRadius.circular(RoseRadius.md),
        child: InkWell(
          key: Key('gift-${gift.slug}'),
          borderRadius: BorderRadius.circular(RoseRadius.md),
          onTap: () => Navigator.of(context).pop(gift),
          child: SizedBox(
            width: 76,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: RoseSpacing.s2),
              child: ExcludeSemantics(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(gift.emoji, style: const TextStyle(fontSize: 34)),
                    Text(gift.name, style: theme.textTheme.labelLarge),
                    Text('${gift.priceCoins}', style: theme.textTheme.labelSmall),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A short celebratory banner: the gift pops in, glows and floats away.
void showGiftToast(BuildContext context, {required Gift gift, required String toName, String? text}) {
  final overlay = Overlay.maybeOf(context, rootOverlay: true);
  if (overlay == null) return;
  late final OverlayEntry entry;
  entry = OverlayEntry(
    builder: (_) => _GiftToast(gift: gift, text: text ?? '${gift.name} sent to $toName', onDone: () => entry.remove()),
  );
  overlay.insert(entry);
}

class _GiftToast extends StatefulWidget {
  const _GiftToast({required this.gift, required this.text, required this.onDone});

  final Gift gift;
  final String text;
  final VoidCallback onDone;

  @override
  State<_GiftToast> createState() => _GiftToastState();
}

class _GiftToastState extends State<_GiftToast> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2200))
    ..forward().whenComplete(widget.onDone);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: IgnorePointer(
        child: AnimatedBuilder(
          animation: _c,
          builder: (context, _) {
            final t = _c.value;
            final pop = Curves.elasticOut.transform((t / 0.35).clamp(0.0, 1.0));
            final fade = t < 0.8 ? 1.0 : 1 - (t - 0.8) / 0.2;
            return Align(
              alignment: Alignment(0, -0.25 - t * 0.25),
              child: Opacity(
                opacity: fade.clamp(0.0, 1.0),
                child: Transform.scale(
                  scale: 0.4 + 0.6 * pop,
                  child: Material(
                    key: const Key('gift-toast'),
                    color: RoseColors.burgundy,
                    elevation: 8,
                    shadowColor: RoseColors.rose300,
                    borderRadius: BorderRadius.circular(999),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Text(widget.gift.emoji, style: TextStyle(fontSize: 30 + 8 * (1 - (t - 0.5).abs()))),
                          const SizedBox(width: 10),
                          Text(
                            widget.text,
                            style: const TextStyle(color: RoseColors.warmIvory, fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
