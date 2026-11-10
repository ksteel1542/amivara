/// Mirrors backend/src/modules/users/age.ts. The server is authoritative; this drives the UI.
abstract final class AgeRules {
  static const int minimumAge = 18;
  static const int maximumAge = 100;

  /// A real calendar date, or null (rejects 30 February and similar).
  static DateTime? date(int year, int month, int day) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    final d = DateTime.utc(year, month, day);
    return d.year == year && d.month == month && d.day == day ? d : null;
  }

  /// Whole years between two calendar dates.
  static int ageOn(DateTime birth, DateTime on) {
    var age = on.year - birth.year;
    if (on.month < birth.month || (on.month == birth.month && on.day < birth.day)) age--;
    return age;
  }

  /// Age that holds on both the Lagos (UTC+1) and UTC calendar dates, like the API.
  static int currentAge(DateTime birth, {DateTime? now}) {
    final utc = (now ?? DateTime.now()).toUtc();
    final lagos = utc.add(const Duration(hours: 1));
    final a = ageOn(birth, DateTime.utc(lagos.year, lagos.month, lagos.day));
    final b = ageOn(birth, DateTime.utc(utc.year, utc.month, utc.day));
    return a < b ? a : b;
  }

  static String iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}
