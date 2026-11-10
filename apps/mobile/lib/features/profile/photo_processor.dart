import 'dart:typed_data';

import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';

/// ARCHITECTURE.md §2: photos are compressed on the device (target ≤ 300 KB)
/// before they are uploaded, to save members' data.
const int kTargetPhotoBytes = 300 * 1024;

/// Picks a photo from the gallery and compresses it. Returns null if the member cancels.
abstract interface class PhotoProcessor {
  Future<Uint8List?> pickAndCompress();
}

class DevicePhotoProcessor implements PhotoProcessor {
  DevicePhotoProcessor({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<Uint8List?> pickAndCompress() async {
    final picked = await _picker.pickImage(source: ImageSource.gallery, requestFullMetadata: false);
    if (picked == null) return null;
    return compressToTarget(await picked.readAsBytes());
  }
}

/// Compression steps, tried in order until the result fits [kTargetPhotoBytes]:
/// keep a sharp 1440px long edge while lowering quality, then shrink.
const List<({int edge, int quality})> kCompressionSteps = <({int edge, int quality})>[
  (edge: 1440, quality: 85),
  (edge: 1440, quality: 75),
  (edge: 1440, quality: 65),
  (edge: 1280, quality: 65),
  (edge: 1080, quality: 60),
  (edge: 960, quality: 55),
  (edge: 800, quality: 50),
];

/// Re-encodes to JPEG (EXIF, including GPS location, is dropped: keepExif is false).
Future<Uint8List> compressToTarget(
  Uint8List original, {
  int targetBytes = kTargetPhotoBytes,
  Future<Uint8List> Function(Uint8List bytes, int edge, int quality)? encoder,
}) async {
  final encode =
      encoder ??
      (Uint8List bytes, int edge, int quality) => FlutterImageCompress.compressWithList(
        bytes,
        minWidth: edge,
        minHeight: edge,
        quality: quality,
        format: CompressFormat.jpeg,
        keepExif: false,
      );

  Uint8List? last;
  for (final step in kCompressionSteps) {
    last = await encode(original, step.edge, step.quality);
    if (last.length <= targetBytes) return last;
  }
  return last!; // smallest attempt; the API still enforces its own hard limit
}
