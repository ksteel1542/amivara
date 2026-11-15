import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import 'wallet_repository.dart';

/// How often the sheet asks the API about a checkout while the member pays.
final topupPollIntervalProvider = Provider<Duration>((ref) => const Duration(seconds: 3));

/// Stop watching after this long; coins still arrive on their own once Paystack confirms.
const Duration topupWatchLimit = Duration(minutes: 15);

/// The checkout this build uses (overridable in tests).
final paymentProviderNameProvider = Provider<String>((ref) => AppConfig.paymentProvider);

/// What a successful top-up added.
class TopupResult {
  const TopupResult({required this.coinsAdded, required this.balance});

  final int coinsAdded;
  final int balance;
}

/// Opens the in-chat top-up sheet; after a successful payment shows the
/// "Payment successful" dialog. [needed] is the shortfall from a 402
/// INSUFFICIENT_COINS, when the sheet opened because of one.
Future<TopupResult?> showTopUpSheet(BuildContext context, {int? needed}) async {
  final result = await showModalBottomSheet<TopupResult>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (_) => TopUpSheet(needed: needed),
  );
  if (result != null && context.mounted) {
    await showDialog<void>(
      context: context,
      builder: (_) => PaymentSuccessDialog(result: result),
    );
  }
  return result;
}

class TopUpSheet extends ConsumerStatefulWidget {
  const TopUpSheet({super.key, this.needed});

  final int? needed;

  @override
  ConsumerState<TopUpSheet> createState() => _TopUpSheetState();
}

class _TopUpSheetState extends ConsumerState<TopUpSheet> with WidgetsBindingObserver {
  Wallet? _wallet;
  String? _error;
  String? _startingId;
  Topup? _waiting;
  bool _gaveUp = false;
  Timer? _poll;
  DateTime? _watchStarted;
  bool _checking = false;

  String get _token => ref.read(sessionProvider)!.accessToken;
  WalletRepository get _repo => ref.read(walletRepositoryProvider);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    super.dispose();
  }

  /// Back from the checkout tab: check straight away instead of waiting for the next tick.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _waiting != null) unawaited(_check());
  }

  Future<void> _load() async {
    try {
      final wallet = await _repo.wallet(_token);
      if (mounted) setState(() => _wallet = wallet);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _buy(CoinPackage package) async {
    if (_startingId != null) return;
    setState(() {
      _startingId = package.id;
      _error = null;
    });
    try {
      final topup = await _repo.startTopup(
        _token,
        packageId: package.id,
        provider: ref.read(paymentProviderNameProvider),
      );
      final url = topup.checkoutUrl == null ? null : Uri.tryParse(topup.checkoutUrl!);
      if (url == null || !await ref.read(checkoutLauncherProvider).open(url)) {
        throw const ApiException(0, 'CHECKOUT', "We couldn't open the payment page. Please try again.");
      }
      if (!mounted) return;
      setState(() {
        _waiting = topup;
        _gaveUp = false;
        _watchStarted = DateTime.now();
      });
      _poll?.cancel();
      _poll = Timer.periodic(ref.read(topupPollIntervalProvider), (_) => unawaited(_check()));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _startingId = null);
    }
  }

  Future<void> _check() async {
    final waiting = _waiting;
    if (waiting == null || _checking) return;
    if (DateTime.now().difference(_watchStarted!) > topupWatchLimit) {
      _poll?.cancel();
      setState(() => _gaveUp = true);
      return;
    }
    _checking = true;
    try {
      final topup = await _repo.topup(_token, waiting.id);
      if (!mounted) return;
      switch (topup.status) {
        case TopupStatus.succeeded:
          _poll?.cancel();
          Navigator.of(
            context,
          ).pop(TopupResult(coinsAdded: topup.totalCoins ?? topup.coins, balance: topup.balance ?? 0));
        case TopupStatus.failed:
          _poll?.cancel();
          setState(() {
            _waiting = null;
            _error = "That payment didn't go through, and you haven't been charged for coins. Please try again.";
          });
        case TopupStatus.pending:
        case TopupStatus.abandoned:
          break;
      }
    } on ApiException {
      // Offline for a moment: the next tick tries again.
    } finally {
      _checking = false;
    }
  }

  void _stopWaiting() {
    _poll?.cancel();
    setState(() {
      _waiting = null;
      _gaveUp = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      key: const Key('topup-sheet'),
      padding: const EdgeInsets.fromLTRB(RoseSpacing.s4, 0, RoseSpacing.s4, RoseSpacing.s4),
      child: AnimatedSize(
        duration: const Duration(milliseconds: 200),
        child: _waiting != null ? _waitingView(theme) : _packagesView(theme),
      ),
    );
  }

  Widget _header(ThemeData theme) {
    final wallet = _wallet;
    return Row(
      children: <Widget>[
        Expanded(child: Text('Top up coins', style: theme.textTheme.titleLarge)),
        if (wallet != null) CoinBalanceChip(key: const Key('topup-balance'), balance: wallet.balance),
      ],
    );
  }

  Widget _packagesView(ThemeData theme) {
    final wallet = _wallet;
    final children = <Widget>[_header(theme), const SizedBox(height: RoseSpacing.s2)];
    if (widget.needed != null && widget.needed! > 0) {
      children.add(
        Text(
          'You need ${formatThousands(widget.needed!)} more coins for that.',
          key: const Key('topup-needed'),
          style: theme.textTheme.bodyMedium,
        ),
      );
      children.add(const SizedBox(height: RoseSpacing.s2));
    }
    if (_error != null) {
      children.add(
        Padding(
          padding: const EdgeInsets.only(bottom: RoseSpacing.s2),
          child: Text(
            _error!,
            key: const Key('topup-error'),
            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error),
          ),
        ),
      );
    }
    if (wallet == null) {
      children.add(
        _error == null
            ? const Padding(
                padding: EdgeInsets.all(RoseSpacing.s8),
                child: Center(child: CircularProgressIndicator()),
              )
            : const SizedBox.shrink(),
      );
    } else if (!wallet.paymentProviders.contains(ref.read(paymentProviderNameProvider))) {
      children.add(
        Text(
          "Top-ups aren't available in this version of the app yet.",
          key: const Key('topup-unavailable'),
          style: theme.textTheme.bodyMedium,
        ),
      );
    } else {
      if (wallet.firstPurchaseEligible) {
        children.add(
          Text(
            'First top-up bonus: extra coins on any package.',
            key: const Key('topup-first-bonus'),
            style: theme.textTheme.bodySmall?.copyWith(color: RoseColors.gold700),
          ),
        );
        children.add(const SizedBox(height: RoseSpacing.s2));
      }
      for (final p in wallet.packages) {
        children.add(
          _PackageTile(package: p, busy: _startingId == p.id, enabled: _startingId == null, onTap: () => _buy(p)),
        );
      }
      children.add(const SizedBox(height: RoseSpacing.s2));
      children.add(
        Text(
          'Pay by card, bank transfer or USSD (OPay users: choose bank transfer). Secured by Paystack.',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodySmall,
        ),
      );
    }
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
  }

  Widget _waitingView(ThemeData theme) {
    return Column(
      key: const Key('topup-waiting'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _header(theme),
        const SizedBox(height: RoseSpacing.s6),
        if (!_gaveUp) const Center(child: CircularProgressIndicator()),
        const SizedBox(height: RoseSpacing.s4),
        Text(
          _gaveUp
              ? "We're still waiting for Paystack to confirm. If you paid, your coins will arrive "
                    "automatically. You don't need to pay again."
              : 'Finish paying on the Paystack page. Your coins arrive here as soon as the payment is confirmed.',
          key: const Key('topup-waiting-text'),
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium,
        ),
        const SizedBox(height: RoseSpacing.s4),
        if (!_gaveUp)
          FilledButton.tonal(
            key: const Key('topup-check'),
            onPressed: _checking ? null : () => unawaited(_check()),
            child: const Text("I've paid"),
          ),
        TextButton(
          key: const Key('topup-cancel'),
          onPressed: _gaveUp ? () => Navigator.of(context).pop() : _stopWaiting,
          child: Text(_gaveUp ? 'Close' : 'Choose another package'),
        ),
      ],
    );
  }
}

class _PackageTile extends StatelessWidget {
  const _PackageTile({required this.package, required this.busy, required this.enabled, required this.onTap});

  final CoinPackage package;
  final bool busy;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final popular = package.label != null;
    return Padding(
      padding: const EdgeInsets.only(bottom: RoseSpacing.s2),
      child: Material(
        color: popular ? RoseColors.rose100.withValues(alpha: 0.5) : theme.colorScheme.surfaceContainerHighest,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: popular ? RoseColors.champagneGold : Colors.transparent, width: 1.5),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: Key('topup-package-${package.coins}'),
          onTap: enabled ? onTap : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s4, vertical: RoseSpacing.s3),
            child: Row(
              children: <Widget>[
                const Icon(Icons.toll_rounded, color: RoseColors.gold700),
                const SizedBox(width: RoseSpacing.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Wrap(
                        spacing: RoseSpacing.s2,
                        runSpacing: RoseSpacing.s1,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: <Widget>[
                          Text('${formatThousands(package.coins)} coins', style: theme.textTheme.titleMedium),
                          if (popular) _Ribbon(text: package.label!),
                        ],
                      ),
                      if (package.bonus > 0)
                        Text(
                          '+${formatThousands(package.bonus)} bonus coins',
                          style: theme.textTheme.bodySmall?.copyWith(color: RoseColors.gold700),
                        ),
                    ],
                  ),
                ),
                if (busy)
                  const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                else
                  Text(formatNaira(package.priceNgn), style: theme.textTheme.titleMedium),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Ribbon extends StatelessWidget {
  const _Ribbon({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s2, vertical: 2),
    decoration: BoxDecoration(color: RoseColors.champagneGold, borderRadius: BorderRadius.circular(999)),
    child: Text(text, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: RoseColors.burgundyBlack)),
  );
}

/// Coin balance pill (chat app bar, top-up sheet).
class CoinBalanceChip extends StatelessWidget {
  const CoinBalanceChip({super.key, required this.balance});

  final int balance;

  @override
  Widget build(BuildContext context) => Semantics(
    label: '${formatThousands(balance)} coins',
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s2, vertical: RoseSpacing.s1),
      decoration: BoxDecoration(
        color: RoseColors.champagneGold.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Icon(Icons.toll_rounded, size: 16, color: RoseColors.gold700),
          const SizedBox(width: RoseSpacing.s1),
          Text(formatThousands(balance), style: Theme.of(context).textTheme.labelLarge),
        ],
      ),
    ),
  );
}

class PaymentSuccessDialog extends StatelessWidget {
  const PaymentSuccessDialog({super.key, required this.result});

  final TopupResult result;

  @override
  Widget build(BuildContext context) => AlertDialog(
    key: const Key('payment-success'),
    icon: const Icon(Icons.check_circle_rounded, color: RoseColors.statusSuccessLight, size: 48),
    title: const Text('Payment successful'),
    content: Text(
      '${formatThousands(result.coinsAdded)} coins have been added to your wallet. '
      'Your balance is ${formatThousands(result.balance)} coins.',
      textAlign: TextAlign.center,
    ),
    actions: <Widget>[
      FilledButton(
        key: const Key('payment-success-done'),
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Back to chat'),
      ),
    ],
  );
}
