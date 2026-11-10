import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

/// An error from the AMIVARA API (`{ "error": { code, message, details } }`, docs/API.md),
/// or a network failure (`code == 'NETWORK'`).
class ApiException implements Exception {
  const ApiException(this.statusCode, this.code, this.message, [this.details = const <String, dynamic>{}]);

  final int statusCode;
  final String code;
  final String message;
  final Map<String, dynamic> details;

  /// Seconds until a rate limit or lockout ends, when the API says.
  int? get retryAfter => (details['retry_after'] as num?)?.toInt();

  bool get isNetwork => code == 'NETWORK';

  @override
  String toString() => 'ApiException($statusCode $code: $message)';
}

/// Thin JSON client. Every request carries the install id and platform, which
/// the API uses for per-device rate limits and session records.
class ApiClient {
  ApiClient({required this.baseUrl, required this.deviceId, http.Client? httpClient})
    : _http = httpClient ?? http.Client();

  final String baseUrl;
  final String deviceId;
  final http.Client _http;

  static const Duration timeout = Duration(seconds: 20);

  Future<Map<String, dynamic>> post(String path, {Map<String, dynamic>? body, String? bearer}) =>
      _send('POST', path, body: body, bearer: bearer);

  Future<Map<String, dynamic>> get(String path, {String? bearer}) => _send('GET', path, bearer: bearer);

  Future<Map<String, dynamic>> _send(String method, String path, {Map<String, dynamic>? body, String? bearer}) async {
    final request = http.Request(method, Uri.parse('$baseUrl$path'))
      ..headers.addAll(<String, String>{
        'Accept': 'application/json',
        'X-Device-Id': deviceId,
        'X-Platform': 'android',
        if (body != null) 'Content-Type': 'application/json',
        if (bearer != null) 'Authorization': 'Bearer $bearer',
      });
    if (body != null) request.body = jsonEncode(body);

    final http.Response response;
    try {
      response = await http.Response.fromStream(await _http.send(request).timeout(timeout));
    } on TimeoutException {
      throw const ApiException(0, 'NETWORK', 'The connection timed out. Check your network and try again.');
    } on SocketException {
      throw const ApiException(0, 'NETWORK', "You're offline. Check your network and try again.");
    } on http.ClientException {
      throw const ApiException(0, 'NETWORK', "We couldn't reach AMIVARA. Try again.");
    }

    final decoded = response.body.isEmpty ? null : _tryDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    }
    final error = decoded is Map<String, dynamic> ? decoded['error'] : null;
    if (error is Map<String, dynamic>) {
      throw ApiException(
        response.statusCode,
        error['code'] as String? ?? 'ERROR',
        error['message'] as String? ?? 'Something went wrong.',
        (error['details'] as Map<String, dynamic>?) ?? const <String, dynamic>{},
      );
    }
    throw ApiException(response.statusCode, 'ERROR', 'Something went wrong. Please try again.');
  }

  static Object? _tryDecode(String body) {
    try {
      return jsonDecode(body);
    } on FormatException {
      return null;
    }
  }
}
