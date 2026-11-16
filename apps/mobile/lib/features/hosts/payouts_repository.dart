import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';

class Bank {
  const Bank({required this.code, required this.name});

  final String code;
  final String name;
}

class PayoutAccount {
  const PayoutAccount({
    required this.bankCode,
    required this.bankName,
    required this.accountLast4,
    required this.accountName,
  });

  factory PayoutAccount.fromJson(Map<String, dynamic> json) => PayoutAccount(
    bankCode: json['bank_code'] as String,
    bankName: json['bank_name'] as String,
    accountLast4: json['account_last4'] as String,
    accountName: json['account_name'] as String,
  );

  final String bankCode;
  final String bankName;
  final String accountLast4;
  final String accountName;
}

/// One withdrawal (pending, success, failed or reversed).
class Payout {
  const Payout({
    required this.id,
    required this.coins,
    required this.amountKobo,
    required this.status,
    required this.bankName,
    required this.accountLast4,
    required this.createdAt,
    this.failureReason,
  });

  factory Payout.fromJson(Map<String, dynamic> json) => Payout(
    id: json['id'] as String,
    coins: (json['coins'] as num).toInt(),
    amountKobo: (json['amount_kobo'] as num).toInt(),
    status: json['status'] as String,
    bankName: json['bank_name'] as String,
    accountLast4: json['account_last4'] as String,
    createdAt: DateTime.parse(json['created_at'] as String),
    failureReason: json['failure_reason'] as String?,
  );

  final String id;
  final int coins;
  final int amountKobo;
  final String status;
  final String bankName;
  final String accountLast4;
  final DateTime createdAt;
  final String? failureReason;
}

/// GET /hosts/payouts: held vs available, the rules, the bank account and the history.
class PayoutSummary {
  const PayoutSummary({
    required this.pendingCoins,
    required this.pendingKobo,
    required this.availableCoins,
    required this.availableKobo,
    required this.koboPerCoin,
    required this.minWithdrawCoins,
    required this.minWithdrawKobo,
    required this.enabled,
    required this.account,
    required this.payouts,
  });

  factory PayoutSummary.fromJson(Map<String, dynamic> json) {
    int n(String k) => (json[k] as num?)?.toInt() ?? 0;
    return PayoutSummary(
      pendingCoins: n('pending_coins'),
      pendingKobo: n('pending_kobo'),
      availableCoins: n('available_coins'),
      availableKobo: n('available_kobo'),
      koboPerCoin: n('kobo_per_coin'),
      minWithdrawCoins: n('min_withdraw_coins'),
      minWithdrawKobo: n('min_withdraw_kobo'),
      enabled: json['payouts_enabled'] as bool? ?? false,
      account: json['account'] == null ? null : PayoutAccount.fromJson(json['account'] as Map<String, dynamic>),
      payouts: ((json['payouts'] as List<dynamic>?) ?? const <dynamic>[])
          .cast<Map<String, dynamic>>()
          .map(Payout.fromJson)
          .toList(),
    );
  }

  final int pendingCoins;
  final int pendingKobo;
  final int availableCoins;
  final int availableKobo;
  final int koboPerCoin;
  final int minWithdrawCoins;
  final int minWithdrawKobo;
  final bool enabled;
  final PayoutAccount? account;
  final List<Payout> payouts;

  bool get hasPending => payouts.any((p) => p.status == 'pending');
  bool get canWithdraw => enabled && account != null && !hasPending && availableCoins >= minWithdrawCoins;
}

abstract interface class PayoutsRepository {
  Future<PayoutSummary> summary(String accessToken);
  Future<List<Bank>> banks(String accessToken);
  Future<({String accountName, String bankName})> resolve(String accessToken, String bankCode, String accountNumber);
  Future<PayoutAccount> saveAccount(String accessToken, String bankCode, String accountNumber);
  Future<Payout> withdraw(String accessToken);
}

class HttpPayoutsRepository implements PayoutsRepository {
  const HttpPayoutsRepository(this._api);

  final ApiClient _api;

  @override
  Future<PayoutSummary> summary(String accessToken) async =>
      PayoutSummary.fromJson(await _api.get('/hosts/payouts', bearer: accessToken));

  @override
  Future<List<Bank>> banks(String accessToken) async {
    final json = await _api.get('/hosts/banks', bearer: accessToken);
    return (json['banks'] as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map((b) => Bank(code: b['code'] as String, name: b['name'] as String))
        .toList();
  }

  @override
  Future<({String accountName, String bankName})> resolve(
    String accessToken,
    String bankCode,
    String accountNumber,
  ) async {
    final json = await _api.post(
      '/hosts/bank-account/resolve',
      bearer: accessToken,
      body: <String, dynamic>{'bank_code': bankCode, 'account_number': accountNumber},
    );
    return (accountName: json['account_name'] as String, bankName: json['bank_name'] as String);
  }

  @override
  Future<PayoutAccount> saveAccount(String accessToken, String bankCode, String accountNumber) async {
    final json = await _api.post(
      '/hosts/bank-account',
      bearer: accessToken,
      body: <String, dynamic>{'bank_code': bankCode, 'account_number': accountNumber},
    );
    return PayoutAccount.fromJson(json['account'] as Map<String, dynamic>);
  }

  @override
  Future<Payout> withdraw(String accessToken) async => Payout.fromJson(
    (await _api.post('/hosts/withdraw', bearer: accessToken, body: <String, dynamic>{}))['payout']
        as Map<String, dynamic>,
  );
}

/// ₦ with thousands separators, from kobo: 600000 → "₦6,000".
String naira(int kobo) {
  final whole = kobo ~/ 100;
  final digits = whole.toString();
  final out = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write(',');
    out.write(digits[i]);
  }
  final rest = kobo % 100;
  return '₦$out${rest == 0 ? '' : '.${rest.toString().padLeft(2, '0')}'}';
}

/// Overridden in main.dart and in tests.
final payoutsRepositoryProvider = Provider<PayoutsRepository>((ref) => throw UnimplementedError('override in main'));
