import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import 'payouts_repository.dart';

/// On the Host dashboard: held vs available in coins and naira, the bank
/// account, Withdraw, and the payout history (M8).
class PayoutsSection extends ConsumerStatefulWidget {
  const PayoutsSection({super.key});

  @override
  ConsumerState<PayoutsSection> createState() => _PayoutsSectionState();
}

class _PayoutsSectionState extends ConsumerState<PayoutsSection> {
  PayoutSummary? _summary;
  String? _error;

  String get _token => ref.read(sessionProvider)!.accessToken;
  PayoutsRepository get _repo => ref.read(payoutsRepositoryProvider);

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final s = await _repo.summary(_token);
      if (mounted) setState(() => (_summary = s, _error = null));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } on Object {
      if (mounted) setState(() => _error = "Your payouts couldn't load.");
    }
  }

  Future<void> _editAccount() async {
    final saved = await context.push<bool>('/host/bank-account');
    if (saved == true && mounted) await _load();
  }

  Future<void> _withdraw(PayoutSummary s) async {
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      useSafeArea: true,
      isScrollControlled: true,
      builder: (_) => _WithdrawSheet(summary: s),
    );
    if (confirmed != true || !mounted) return;
    try {
      final payout = await _repo.withdraw(_token);
      if (!mounted) return;
      final text = switch (payout.status) {
        'success' => '${naira(payout.amountKobo)} is on its way to your bank.',
        'failed' => "That payout didn't go through. Your coins are back in your balance.",
        _ => 'Payout of ${naira(payout.amountKobo)} started. Most arrive within minutes.',
      };
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = _summary;
    if (s == null) {
      return _error == null
          ? const Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: CircularProgressIndicator()),
            )
          : Text(_error!, key: const Key('payouts-error'));
    }
    final account = s.account;
    return Column(
      key: const Key('payouts-section'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Card(
          child: Padding(
            padding: const EdgeInsets.all(RoseSpacing.s4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Cash out', style: theme.textTheme.titleMedium),
                const SizedBox(height: RoseSpacing.s3),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: _Figure(
                        label: 'On hold (7 days)',
                        naira: naira(s.pendingKobo),
                        coins: s.pendingCoins,
                        valueKey: const Key('payout-pending-naira'),
                      ),
                    ),
                    Expanded(
                      child: _Figure(
                        label: 'Available to withdraw',
                        naira: naira(s.availableKobo),
                        coins: s.availableCoins,
                        valueKey: const Key('payout-available-naira'),
                        highlight: true,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: RoseSpacing.s2),
                Text(
                  '1 coin = ${naira(s.koboPerCoin)} · minimum withdrawal ${naira(s.minWithdrawKobo)}',
                  style: theme.textTheme.bodySmall,
                ),
                const Divider(height: RoseSpacing.s6),
                ListTile(
                  key: Key(account == null ? 'payout-add-account' : 'payout-account'),
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.account_balance_outlined),
                  title: Text(
                    account == null ? 'Add your bank account' : '${account.bankName} ••${account.accountLast4}',
                  ),
                  subtitle: account == null ? const Text('Nigerian banks and OPay') : Text(account.accountName),
                  trailing: Text(account == null ? 'Add' : 'Change'),
                  onTap: _editAccount,
                ),
                const SizedBox(height: RoseSpacing.s2),
                FilledButton(
                  key: const Key('payout-withdraw'),
                  onPressed: s.canWithdraw ? () => _withdraw(s) : null,
                  child: Text(s.hasPending ? 'Payout in progress' : 'Withdraw ${naira(s.availableKobo)}'),
                ),
                if (!s.enabled)
                  Padding(
                    padding: const EdgeInsets.only(top: RoseSpacing.s2),
                    child: Text(
                      'Withdrawals are paused right now. Your earnings are safe.',
                      key: const Key('payouts-paused'),
                      style: theme.textTheme.bodySmall,
                    ),
                  )
                else if (s.availableCoins < s.minWithdrawCoins)
                  Padding(
                    padding: const EdgeInsets.only(top: RoseSpacing.s2),
                    child: Text(
                      'You can withdraw once you have ${naira(s.minWithdrawKobo)} available.',
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
              ],
            ),
          ),
        ),
        if (s.payouts.isNotEmpty) ...<Widget>[
          const SizedBox(height: RoseSpacing.s3),
          Text('Payout history', style: theme.textTheme.titleMedium),
          for (final p in s.payouts) _PayoutRow(payout: p),
        ],
      ],
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({
    required this.label,
    required this.naira,
    required this.coins,
    required this.valueKey,
    this.highlight = false,
  });

  final String label;
  final String naira;
  final int coins;
  final Key valueKey;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(label, style: theme.textTheme.bodySmall),
        Text(
          naira,
          key: valueKey,
          style: theme.textTheme.titleLarge?.copyWith(color: highlight ? theme.colorScheme.primary : null),
        ),
        Text('$coins coins', style: theme.textTheme.labelSmall),
      ],
    );
  }
}

class _PayoutRow extends StatelessWidget {
  const _PayoutRow({required this.payout});

  final Payout payout;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (label, color) = switch (payout.status) {
      'success' => ('Paid', const Color(0xFF2E7D5B)),
      'failed' => ('Failed', theme.colorScheme.error),
      'reversed' => ('Reversed', theme.colorScheme.error),
      _ => ('Processing', const Color(0xFF965C09)),
    };
    final d = payout.createdAt.toLocal();
    return ListTile(
      key: Key('payout-${payout.id}'),
      contentPadding: EdgeInsets.zero,
      title: Text(naira(payout.amountKobo)),
      subtitle: Text(
        '${payout.bankName} ••${payout.accountLast4} · ${d.day}/${d.month}/${d.year}'
        '${payout.failureReason != null && payout.status != 'success' ? '\n${payout.failureReason}' : ''}',
      ),
      trailing: Container(
        key: Key('payout-status-${payout.id}'),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
        child: Text(
          label,
          style: TextStyle(color: color, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}

class _WithdrawSheet extends StatelessWidget {
  const _WithdrawSheet({required this.summary});

  final PayoutSummary summary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final account = summary.account!;
    return SingleChildScrollView(
      key: const Key('withdraw-sheet'),
      padding: const EdgeInsets.fromLTRB(RoseSpacing.s4, 0, RoseSpacing.s4, RoseSpacing.s6),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text('Withdraw your earnings', style: theme.textTheme.titleLarge),
          const SizedBox(height: RoseSpacing.s4),
          Text(naira(summary.availableKobo), key: const Key('withdraw-amount'), style: theme.textTheme.displaySmall),
          Text('${summary.availableCoins} coins', style: theme.textTheme.bodySmall),
          const SizedBox(height: RoseSpacing.s3),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.account_balance_outlined),
            title: Text('${account.bankName} ••${account.accountLast4}', key: const Key('withdraw-destination')),
            subtitle: Text(account.accountName),
          ),
          Text(
            'Sent by bank transfer through Paystack. Most payouts arrive within minutes; '
            "if a transfer fails, the coins come straight back to your balance.",
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: RoseSpacing.s4),
          FilledButton(
            key: const Key('withdraw-confirm'),
            onPressed: () => Navigator.pop(context, true),
            child: Text('Withdraw ${naira(summary.availableKobo)}'),
          ),
        ],
      ),
    );
  }
}

/// Bank account setup: pick the bank, type the 10-digit account number, and the
/// account holder's name is looked up before you can save (M8).
class BankAccountScreen extends ConsumerStatefulWidget {
  const BankAccountScreen({super.key});

  @override
  ConsumerState<BankAccountScreen> createState() => _BankAccountScreenState();
}

class _BankAccountScreenState extends ConsumerState<BankAccountScreen> {
  final TextEditingController _number = TextEditingController();
  List<Bank>? _banks;
  Bank? _bank;
  String? _resolvedName;
  String? _resolvedFor;
  bool _resolving = false;
  bool _saving = false;
  String? _error;

  String get _token => ref.read(sessionProvider)!.accessToken;
  PayoutsRepository get _repo => ref.read(payoutsRepositoryProvider);

  @override
  void initState() {
    super.initState();
    unawaited(_loadBanks());
  }

  @override
  void dispose() {
    _number.dispose();
    super.dispose();
  }

  Future<void> _loadBanks() async {
    try {
      final banks = await _repo.banks(_token);
      if (mounted) setState(() => _banks = banks);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  /// Looks the name up as soon as there's a bank and 10 digits.
  Future<void> _maybeResolve() async {
    final number = _number.text.trim();
    final bank = _bank;
    setState(() {
      _error = null;
      if (_resolvedFor != '${bank?.code}:$number') _resolvedName = null;
    });
    if (bank == null || !RegExp(r'^\d{10}$').hasMatch(number) || _resolvedFor == '${bank.code}:$number') return;
    setState(() => _resolving = true);
    try {
      final r = await _repo.resolve(_token, bank.code, number);
      if (!mounted || _number.text.trim() != number || _bank != bank) return;
      setState(() {
        _resolvedName = r.accountName;
        _resolvedFor = '${bank.code}:$number';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _resolving = false);
    }
  }

  Future<void> _save() async {
    final bank = _bank!;
    setState(() => _saving = true);
    try {
      await _repo.saveAccount(_token, bank.code, _number.text.trim());
      if (mounted) context.pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => (_error = e.message, _saving = false));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final banks = _banks;
    return Scaffold(
      appBar: AppBar(title: const Text('Bank account')),
      body: ListView(
        key: const Key('bank-account-screen'),
        padding: const EdgeInsets.all(RoseSpacing.s4),
        children: <Widget>[
          const Text('Payouts go to a Nigerian bank account or OPay wallet in your name.'),
          const SizedBox(height: RoseSpacing.s4),
          if (banks == null && _error == null)
            const Center(child: CircularProgressIndicator())
          else if (banks != null) ...<Widget>[
            DropdownButtonFormField<Bank>(
              key: const Key('bank-dropdown'),
              initialValue: _bank,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Bank'),
              items: <DropdownMenuItem<Bank>>[
                for (final b in banks)
                  DropdownMenuItem<Bank>(
                    key: Key('bank-option-${b.code}'),
                    value: b,
                    child: Text(b.name, overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: (b) {
                setState(() => _bank = b);
                unawaited(_maybeResolve());
              },
            ),
            const SizedBox(height: RoseSpacing.s3),
            TextField(
              key: const Key('bank-account-number'),
              controller: _number,
              keyboardType: TextInputType.number,
              maxLength: 10,
              decoration: const InputDecoration(labelText: 'Account number', hintText: '10 digits'),
              onChanged: (_) => unawaited(_maybeResolve()),
            ),
            const SizedBox(height: RoseSpacing.s2),
            if (_resolving)
              const Row(
                children: <Widget>[
                  SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                  SizedBox(width: 8),
                  Text('Checking the account…'),
                ],
              ),
            if (_resolvedName != null)
              Card(
                color: theme.colorScheme.secondaryContainer,
                child: ListTile(
                  leading: const Icon(Icons.verified_user_outlined),
                  title: Text(_resolvedName!, key: const Key('bank-resolved-name')),
                  subtitle: const Text('Is this you? Payouts can only go to an account in your name.'),
                ),
              ),
          ],
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: RoseSpacing.s2),
              child: Text(
                _error!,
                key: const Key('bank-error'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ),
          const SizedBox(height: RoseSpacing.s4),
          FilledButton(
            key: const Key('bank-save'),
            onPressed: _resolvedName != null && !_saving ? _save : null,
            child: const Text('Yes, save this account'),
          ),
        ],
      ),
    );
  }
}
