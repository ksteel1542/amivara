import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import 'payouts_screens.dart';
import '../wallet/wallet_repository.dart' show formatThousands;

/// The member's Host status (GET /me/host). [status] is null when they've never opted in.
class HostState {
  const HostState({this.status, this.pendingCoins = 0, this.availableCoins = 0, this.holdDays = 7});

  final String? status;
  final int pendingCoins;
  final int availableCoins;
  final int holdDays;

  bool get active => status == 'active';
}

abstract interface class HostRepository {
  Future<HostState> load(String accessToken);
  Future<HostState> optIn(String accessToken);
  Future<HostState> pause(String accessToken);
}

class HttpHostRepository implements HostRepository {
  const HttpHostRepository(this._api);

  final ApiClient _api;

  Future<HostState> _withEarnings(String token, Map<String, dynamic> json) async {
    final host = json['host'] as Map<String, dynamic>?;
    if (host == null) return const HostState();
    final earnings = await _api.get('/me/host/earnings', bearer: token);
    return HostState(
      status: host['status'] as String?,
      pendingCoins: (earnings['pending_coins'] as num?)?.toInt() ?? 0,
      availableCoins: (earnings['available_coins'] as num?)?.toInt() ?? 0,
      holdDays: (earnings['hold_days'] as num?)?.toInt() ?? 7,
    );
  }

  @override
  Future<HostState> load(String accessToken) async =>
      _withEarnings(accessToken, await _api.get('/me/host', bearer: accessToken));

  @override
  Future<HostState> optIn(String accessToken) async =>
      _withEarnings(accessToken, await _api.post('/me/host', bearer: accessToken));

  @override
  Future<HostState> pause(String accessToken) async =>
      _withEarnings(accessToken, await _api.post('/me/host/pause', bearer: accessToken));
}

/// Overridden in main.dart and in tests.
final hostRepositoryProvider = Provider<HostRepository>((ref) => throw UnimplementedError('override in main'));

/// Opt-in Verified Host mode (MONETIZATION_PLAN.md 2a): any verified member can host.
class HostScreen extends ConsumerStatefulWidget {
  const HostScreen({super.key});

  @override
  ConsumerState<HostScreen> createState() => _HostScreenState();
}

class _HostScreenState extends ConsumerState<HostScreen> {
  HostState? _state;
  String? _error;
  bool _busy = false;

  String get _token => ref.read(sessionProvider)!.accessToken;
  HostRepository get _repo => ref.read(hostRepositoryProvider);

  @override
  void initState() {
    super.initState();
    unawaited(_run(() => _repo.load(_token)));
  }

  Future<void> _run(Future<HostState> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final state = await action();
      if (mounted) setState(() => _state = state);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final state = _state;
    return Scaffold(
      appBar: AppBar(title: const Text('Verified Host')),
      body: state == null && _error == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              key: const Key('host-screen'),
              padding: const EdgeInsets.all(RoseSpacing.s4),
              children: <Widget>[
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: RoseSpacing.s3),
                    child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
                  ),
                if (state != null && state.active) ...<Widget>[
                  Text("You're a Verified Host", style: theme.textTheme.titleLarge),
                  const SizedBox(height: RoseSpacing.s2),
                  const Text(
                    'Members get a few free messages a day with you, then pay coins per message. '
                    'You earn a share of the coins they bought. You get conversation starters in your chats.',
                  ),
                  const SizedBox(height: RoseSpacing.s4),
                  _EarningsCard(state: state),
                  const SizedBox(height: RoseSpacing.s4),
                  const PayoutsSection(),
                  const SizedBox(height: RoseSpacing.s4),
                  OutlinedButton(
                    key: const Key('host-pause'),
                    onPressed: _busy ? null : () => _run(() => _repo.pause(_token)),
                    child: const Text('Pause hosting'),
                  ),
                ] else ...<Widget>[
                  Text('Become a Verified Host', style: theme.textTheme.titleLarge),
                  const SizedBox(height: RoseSpacing.s2),
                  const Text(
                    'Earn from your conversations. After a few free messages a day, members pay coins to keep '
                    'chatting with you, and you earn a share of the coins they bought.\n\n'
                    "Your earnings are held for a few days before you can withdraw them. Normal community "
                    'guidelines apply: never ask anyone for money or to move off AMIVARA.',
                  ),
                  if (state != null && state.pendingCoins + state.availableCoins > 0) ...<Widget>[
                    const SizedBox(height: RoseSpacing.s4),
                    _EarningsCard(state: state),
                    const SizedBox(height: RoseSpacing.s4),
                    // Paused Hosts can still withdraw what they earned.
                    const PayoutsSection(),
                  ],
                  const SizedBox(height: RoseSpacing.s4),
                  FilledButton(
                    key: const Key('host-opt-in'),
                    onPressed: _busy ? null : () => _run(() => _repo.optIn(_token)),
                    child: Text(state?.status == 'paused' ? 'Resume hosting' : 'Become a Host'),
                  ),
                ],
              ],
            ),
    );
  }
}

class _EarningsCard extends StatelessWidget {
  const _EarningsCard({required this.state});

  final HostState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Widget figure(String label, int coins, Key key) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: theme.textTheme.bodySmall),
          Text('${formatThousands(coins)} coins', key: key, style: theme.textTheme.titleMedium),
        ],
      ),
    );
    return Card(
      key: const Key('host-earnings'),
      child: Padding(
        padding: const EdgeInsets.all(RoseSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                figure('Held', state.pendingCoins, const Key('host-pending')),
                figure('Available', state.availableCoins, const Key('host-available')),
              ],
            ),
            const SizedBox(height: RoseSpacing.s2),
            Text(
              'Earnings are held for ${state.holdDays} days, then you can withdraw them to your bank.',
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
