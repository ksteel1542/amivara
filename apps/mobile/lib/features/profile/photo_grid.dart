import 'package:flutter/material.dart';

import '../../theme/rose_tokens.g.dart';
import 'profile_models.dart';

typedef PhotoImageBuilder = Widget Function(BuildContext context, ProfilePhoto photo);

Widget _networkImage(BuildContext context, ProfilePhoto photo) => Image.network(
  photo.url,
  fit: BoxFit.cover,
  errorBuilder: (context, error, stack) => const ColoredBox(color: Colors.black12),
);

/// 3 × 2 grid of photo slots (max 6). Slot 0 is the primary photo.
/// Long-press a photo and drop it on another slot to reorder; tap an empty
/// slot to add a photo; tap a photo for its actions.
class PhotoGrid extends StatelessWidget {
  const PhotoGrid({
    super.key,
    required this.photos,
    required this.onReorder,
    required this.onAdd,
    required this.onPhotoTap,
    this.maxPhotos = 6,
    this.uploading = false,
    this.imageBuilder = _networkImage,
  });

  final List<ProfilePhoto> photos;
  final int maxPhotos;
  final bool uploading;

  /// New order of photo ids after a drag-and-drop.
  final ValueChanged<List<String>> onReorder;
  final VoidCallback onAdd;
  final ValueChanged<ProfilePhoto> onPhotoTap;
  final PhotoImageBuilder imageBuilder;

  void _drop(String draggedId, int targetIndex) {
    final ids = photos.map((p) => p.id).toList();
    final from = ids.indexOf(draggedId);
    if (from < 0 || from == targetIndex) return;
    ids.insert(targetIndex.clamp(0, ids.length - 1), ids.removeAt(from));
    onReorder(ids);
  }

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: RoseSpacing.s2,
      crossAxisSpacing: RoseSpacing.s2,
      childAspectRatio: 3 / 4,
      children: <Widget>[
        for (var i = 0; i < maxPhotos; i++)
          if (i < photos.length)
            _PhotoSlot(
              key: Key('photo-slot-$i'),
              photo: photos[i],
              index: i,
              imageBuilder: imageBuilder,
              onDrop: (draggedId) => _drop(draggedId, i),
              onTap: () => onPhotoTap(photos[i]),
            )
          else if (i == photos.length)
            _AddSlot(key: Key('photo-slot-$i'), uploading: uploading, onTap: uploading ? null : onAdd)
          else
            _EmptySlot(key: Key('photo-slot-$i')),
      ],
    );
  }
}

class _PhotoSlot extends StatelessWidget {
  const _PhotoSlot({
    super.key,
    required this.photo,
    required this.index,
    required this.imageBuilder,
    required this.onDrop,
    required this.onTap,
  });

  final ProfilePhoto photo;
  final int index;
  final PhotoImageBuilder imageBuilder;
  final ValueChanged<String> onDrop;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final tile = ClipRRect(
      borderRadius: BorderRadius.circular(RoseRadius.md),
      child: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          imageBuilder(context, photo),
          if (index == 0)
            Positioned(
              left: RoseSpacing.s1,
              bottom: RoseSpacing.s1,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s2, vertical: 2),
                decoration: BoxDecoration(color: scheme.primary, borderRadius: BorderRadius.circular(RoseRadius.full)),
                child: Text('Main', style: Theme.of(context).textTheme.labelMedium?.copyWith(color: scheme.onPrimary)),
              ),
            ),
        ],
      ),
    );

    return DragTarget<String>(
      onWillAcceptWithDetails: (details) => details.data != photo.id,
      onAcceptWithDetails: (details) => onDrop(details.data),
      builder: (context, candidates, rejected) => LongPressDraggable<String>(
        data: photo.id,
        feedback: SizedBox(width: 96, height: 128, child: Opacity(opacity: 0.85, child: tile)),
        childWhenDragging: Opacity(opacity: 0.3, child: tile),
        child: Semantics(
          button: true,
          label: index == 0 ? 'Main photo. Long-press to move.' : 'Photo ${index + 1}. Long-press to move.',
          child: GestureDetector(
            onTap: onTap,
            child: DecoratedBox(
              position: DecorationPosition.foreground,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(RoseRadius.md),
                border: candidates.isNotEmpty ? Border.all(color: scheme.primary, width: 3) : null,
              ),
              child: tile,
            ),
          ),
        ),
      ),
    );
  }
}

class _AddSlot extends StatelessWidget {
  const _AddSlot({super.key, required this.uploading, required this.onTap});

  final bool uploading;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      label: 'Add a photo',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(RoseRadius.md),
        child: Container(
          decoration: BoxDecoration(
            color: scheme.surfaceContainer,
            borderRadius: BorderRadius.circular(RoseRadius.md),
            border: Border.all(color: scheme.primary.withValues(alpha: 0.5)),
          ),
          child: Center(
            child: uploading
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5))
                : Icon(Icons.add_a_photo_outlined, color: scheme.primary),
          ),
        ),
      ),
    );
  }
}

class _EmptySlot extends StatelessWidget {
  const _EmptySlot({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainer,
        borderRadius: BorderRadius.circular(RoseRadius.md),
      ),
    );
  }
}
