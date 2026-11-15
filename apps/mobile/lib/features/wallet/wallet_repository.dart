import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';

/// One top-up package from GET /wallet (docs/API.md "Wallet").
class CoinPackage {
  const CoinPackage({
    required this.id,
    required this.coins,
    required this.totalCoins,
    required this.firstPurchaseBonus,
    required this.priceNgn,
    this.label,
  });

  factory CoinPackage.fromJson(Map<String, dynamic> json) => CoinPackage(
    id: json['id'] as String,
    coins: (json['coins'] as num).toInt(),
    totalCoins: (json['total_coins'] as num).toInt(),
    firstPurchaseBonus: (json['first_purchase_bonus'] as num?)?.toInt() ?? 0,
    priceNgn: (json['price_ngn'] as num).toInt(),
    label: json['label'] as String?,
  );

  final String id;
  final int coins;

  /// Coins plus any bonus this member would get now (the first-purchase bonus included).
  final int totalCoins;
  final int firstPurchaseBonus;
  final int priceNgn;

  /// e.g. "Most popular"
  final String? label;

  int get bonus => totalCoins - coins;
}

class Wallet {
  const Wallet({
    required this.balance,
    required this.firstPurchaseEligible,
    required this.packages,
    required this.paymentProviders,
  });

  factory Wallet.fromJson(Map<String, dynamic> json) => Wallet(
    balance: (json['balance'] as num).toInt(),
    firstPurchaseEligible: json['first_purchase_eligible'] as bool? ?? false,
    packages: ((json['packages'] as List<dynamic>?) ?? const <dynamic>[])
        .cast<Map<String, dynamic>>()
        .map(CoinPackage.fromJson)
        .toList(),
    paymentProviders: ((json['payment_providers'] as List<dynamic>?) ?? const <dynamic>[]).cast<String>(),
  );

  final int balance;
  final bool firstPurchaseEligible;
  final List<CoinPackage> packages;

  /// Checkouts the API accepts right now ('paystack', 'google_play').
  final List<String> paymentProviders;
}

enum TopupStatus { pending, succeeded, failed, abandoned }

/// A top-up from POST /wallet/topups or GET /wallet/topups/:id.
class Topup {
  const Topup({
    required this.id,
    required this.status,
    required this.coins,
    this.totalCoins,
    this.balance,
    this.checkoutUrl,
  });

  factory Topup.fromJson(Map<String, dynamic> json) => Topup(
    id: json['id'] as String,
    status: TopupStatus.values.byName(json['status'] as String),
    coins: (json['coins'] as num).toInt(),
    totalCoins: (json['total_coins'] as num?)?.toInt(),
    balance: (json['balance'] as num?)?.toInt(),
    checkoutUrl: json['checkout_url'] as String?,
  );

  final String id;
  final TopupStatus status;
  final int coins;

  /// Coins credited, bonus included (once succeeded).
  final int? totalCoins;

  /// The member's balance after crediting (once succeeded).
  final int? balance;

  /// Where the member pays (only when the top-up was just created).
  final String? checkoutUrl;
}

abstract interface class WalletRepository {
  Future<Wallet> wallet(String accessToken);
  Future<Topup> startTopup(String accessToken, {required String packageId, required String provider});
  Future<Topup> topup(String accessToken, String id);
}

class HttpWalletRepository implements WalletRepository {
  const HttpWalletRepository(this._api);

  final ApiClient _api;

  @override
  Future<Wallet> wallet(String accessToken) async => Wallet.fromJson(await _api.get('/wallet', bearer: accessToken));

  @override
  Future<Topup> startTopup(String accessToken, {required String packageId, required String provider}) async =>
      Topup.fromJson(
        await _api.post(
          '/wallet/topups',
          bearer: accessToken,
          body: <String, dynamic>{'package_id': packageId, 'provider': provider},
        ),
      );

  @override
  Future<Topup> topup(String accessToken, String id) async =>
      Topup.fromJson(await _api.get('/wallet/topups/$id', bearer: accessToken));
}

/// Opens the provider's hosted checkout. A Custom Tab keeps the member in the app's task,
/// and the card or bank details go straight to Paystack, never through AMIVARA.
abstract interface class CheckoutLauncher {
  Future<bool> open(Uri url);
}

class CustomTabCheckoutLauncher implements CheckoutLauncher {
  const CustomTabCheckoutLauncher();

  @override
  Future<bool> open(Uri url) => launchUrl(url, mode: LaunchMode.inAppBrowserView);
}

/// Overridden in main.dart and in tests.
final walletRepositoryProvider = Provider<WalletRepository>((ref) => throw UnimplementedError('override in main'));

final checkoutLauncherProvider = Provider<CheckoutLauncher>((ref) => const CustomTabCheckoutLauncher());

/// ₦3,500
String formatNaira(int naira) => '₦${formatThousands(naira)}';

/// 10,000
String formatThousands(int n) {
  final digits = n.abs().toString();
  final out = StringBuffer(n < 0 ? '-' : '');
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write(',');
    out.write(digits[i]);
  }
  return out.toString();
}
