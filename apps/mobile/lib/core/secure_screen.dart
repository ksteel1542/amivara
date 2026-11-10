import 'package:flutter/services.dart';

/// Blocks screenshots and screen recording while sensitive data is on screen
/// (Android FLAG_SECURE, via MainActivity). Used on the NIN screen (UI_WIREFRAMES 5c).
abstract final class SecureScreen {
  static const MethodChannel _channel = MethodChannel('amivara/secure_screen');

  static Future<void> enable() => _call('enable');

  static Future<void> disable() => _call('disable');

  static Future<void> _call(String method) async {
    try {
      await _channel.invokeMethod<void>(method);
    } on MissingPluginException {
      // Tests and non-Android hosts: nothing to do.
    } on PlatformException {
      // Never block the flow because the flag could not be set.
    }
  }
}
