/// Client-side check for Nigerian mobile numbers (UI_WIREFRAMES Screen 2a).
/// The API re-validates with full libphonenumber metadata; this only drives
/// the button state and formatting while typing.
abstract final class NigerianPhone {
  /// National significant number: 10 digits starting 70x, 80x, 81x, 90x or 91x.
  static final RegExp _national = RegExp(r'^[789][01]\d{8}$');

  /// Digits the member typed, with a leading 0 or 234 removed.
  static String nationalDigits(String input) {
    var digits = input.replaceAll(RegExp(r'\D'), '');
    if (digits.startsWith('234') && digits.length > 10) digits = digits.substring(3);
    if (digits.startsWith('0')) digits = digits.substring(1);
    return digits;
  }

  /// "+2348012345678", or null if not a plausible Nigerian mobile number.
  static String? toE164(String input) {
    final national = nationalDigits(input);
    return _national.hasMatch(national) ? '+234$national' : null;
  }

  /// "801 234 5678" for display.
  static String format(String input) {
    final d = nationalDigits(input);
    if (d.length <= 3) return d;
    if (d.length <= 6) return '${d.substring(0, 3)} ${d.substring(3)}';
    return '${d.substring(0, 3)} ${d.substring(3, 6)} ${d.substring(6, d.length.clamp(6, 10))}';
  }
}
