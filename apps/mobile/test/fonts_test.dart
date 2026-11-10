import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:amivara/main.dart';
import 'package:amivara/theme/rose_tokens.g.dart';

/// Characters every bundled font must render natively (no fallback).
/// Keep in sync with REQUIRED in scripts/fonts/build_fonts.py.
const Map<String, String> requiredCharacters = <String, String>{
  'Yoruba': 'ẸẹỌọṢṣŃńǸǹÀàÁáÈèÉéÌìÍíÒòÓóÙùÚú',
  'Igbo': 'ỊịỤụṄṅ',
  'Hausa': 'ƁɓƊɗƘƙƳƴʼ',
  'Combining marks': '̣̀́̄',
  'Naira': '₦',
};

const Map<String, List<int>> expectedFamilies = <String, List<int>>{
  'Playfair': <int>[600, 700],
  'Inter': <int>[400, 500, 600],
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<Map<String, dynamic>> manifest;

  setUpAll(() async {
    final raw = await rootBundle.loadString('FontManifest.json');
    manifest = (jsonDecode(raw) as List<dynamic>).cast<Map<String, dynamic>>();
  });

  List<Map<String, dynamic>> fontsOf(String family) =>
      (manifest.firstWhere((f) => f['family'] == family)['fonts'] as List<dynamic>).cast<Map<String, dynamic>>();

  test('pubspec bundles the families the design tokens use, at the right weights', () {
    expect(RoseFonts.display, 'Playfair');
    expect(RoseFonts.body, 'Inter');
    for (final entry in expectedFamilies.entries) {
      final weights = fontsOf(entry.key).map((f) => f['weight'] as int).toList()..sort();
      expect(weights, entry.value, reason: '${entry.key} weights');
    }
  });

  test('every type role uses a bundled family and weight (no synthetic bold)', () {
    final styles = <String, TextStyle>{
      'displayLarge': RoseType.displayLarge,
      'displaySmall': RoseType.displaySmall,
      'headlineLarge': RoseType.headlineLarge,
      'headlineMedium': RoseType.headlineMedium,
      'headlineSmall': RoseType.headlineSmall,
      'titleLarge': RoseType.titleLarge,
      'titleMedium': RoseType.titleMedium,
      'bodyLarge': RoseType.bodyLarge,
      'bodyMedium': RoseType.bodyMedium,
      'bodySmall': RoseType.bodySmall,
      'labelLarge': RoseType.labelLarge,
      'labelMedium': RoseType.labelMedium,
    };
    for (final MapEntry(key: role, value: style) in styles.entries) {
      final weights = expectedFamilies[style.fontFamily];
      expect(weights, isNotNull, reason: '$role uses unbundled family ${style.fontFamily}');
      expect(weights, contains(style.fontWeight!.value), reason: '$role weight ${style.fontWeight}');
    }
  });

  for (final family in expectedFamilies.keys) {
    group('$family files', () {
      test('cover Yoruba, Igbo, Hausa and ₦ natively', () async {
        for (final font in fontsOf(family)) {
          final asset = font['asset'] as String;
          final cmap = _readCmap(await rootBundle.load(asset));
          // Parser sanity: present and absent characters must be told apart.
          expect(cmap['A'.codeUnitAt(0)] ?? 0, isNot(0), reason: '$asset has no "A"?');
          expect(cmap[0x4E00] ?? 0, 0, reason: '$asset unexpectedly maps a CJK character (subset not applied?)');
          for (final MapEntry(key: language, value: chars) in requiredCharacters.entries) {
            final missing = chars.runes
                .where((r) => (cmap[r] ?? 0) == 0)
                .map((r) => 'U+${r.toRadixString(16).toUpperCase().padLeft(4, '0')}')
                .toList();
            expect(missing, isEmpty, reason: '$asset is missing $language characters');
          }
        }
      });

      test('load with the engine', () async {
        final loader = FontLoader(family);
        for (final font in fontsOf(family)) {
          loader.addFont(rootBundle.load(font['asset'] as String));
        }
        await expectLater(loader.load(), completes);
      });
    });
  }

  test('OFL licences are registered for the licence page', () async {
    registerFontLicenses();
    final packages = <String>{};
    await for (final entry in LicenseRegistry.licenses) {
      packages.addAll(entry.packages);
    }
    expect(packages, containsAll(<String>['Playfair', 'Inter']));
  });
}

/// Minimal TrueType/OpenType `cmap` reader: returns codepoint → glyph id from
/// the best Unicode subtable (format 12 preferred, else format 4).
Map<int, int> _readCmap(ByteData font) {
  final numTables = font.getUint16(4);
  int? cmapOffset;
  for (var i = 0; i < numTables; i++) {
    final record = 12 + i * 16;
    final tag = String.fromCharCodes(Uint8List.sublistView(font, record, record + 4));
    if (tag == 'cmap') cmapOffset = font.getUint32(record + 8);
  }
  if (cmapOffset == null) throw StateError('font has no cmap table');

  final subtables = font.getUint16(cmapOffset + 2);
  int? format4;
  int? format12;
  for (var i = 0; i < subtables; i++) {
    final record = cmapOffset + 4 + i * 8;
    final platform = font.getUint16(record);
    final encoding = font.getUint16(record + 2);
    final offset = cmapOffset + font.getUint32(record + 4);
    final format = font.getUint16(offset);
    final unicode = platform == 0 || (platform == 3 && (encoding == 1 || encoding == 10));
    if (!unicode) continue;
    if (format == 12) format12 = offset;
    if (format == 4) format4 = offset;
  }

  final map = <int, int>{};
  if (format12 != null) {
    final groups = font.getUint32(format12 + 12);
    for (var g = 0; g < groups; g++) {
      final group = format12 + 16 + g * 12;
      final start = font.getUint32(group);
      final end = font.getUint32(group + 4);
      final glyph = font.getUint32(group + 8);
      for (var c = start; c <= end; c++) {
        map[c] = glyph + (c - start);
      }
    }
    return map;
  }
  if (format4 != null) {
    final segX2 = font.getUint16(format4 + 6);
    final ends = format4 + 14;
    final starts = ends + segX2 + 2;
    final deltas = starts + segX2;
    final rangeOffsets = deltas + segX2;
    for (var s = 0; s < segX2 ~/ 2; s++) {
      final end = font.getUint16(ends + s * 2);
      final start = font.getUint16(starts + s * 2);
      final delta = font.getInt16(deltas + s * 2);
      final rangeOffsetPos = rangeOffsets + s * 2;
      final rangeOffset = font.getUint16(rangeOffsetPos);
      for (var c = start; c <= end && c != 0xFFFF; c++) {
        int glyph;
        if (rangeOffset == 0) {
          glyph = (c + delta) & 0xFFFF;
        } else {
          final glyphPos = rangeOffsetPos + rangeOffset + (c - start) * 2;
          final raw = font.getUint16(glyphPos);
          glyph = raw == 0 ? 0 : (raw + delta) & 0xFFFF;
        }
        map[c] = glyph;
      }
    }
    return map;
  }
  throw StateError('font has no Unicode cmap subtable');
}
