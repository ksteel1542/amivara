import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../theme/rose_tokens.g.dart';

enum SwipeDirection { left, right }

/// Decides whether a swipe may complete. Returning false springs the card back
/// (e.g. an unverified member swiping right is shown the verify prompt instead).
typedef SwipeGate = Future<bool> Function(SwipeDirection direction);

/// A stack of cards: drag the top card left (pass) or right (like).
/// Past ~28% of the width, or with a fast fling, the card flies off;
/// otherwise it springs back. [swipe] does the same from the buttons.
class SwipeCardStack extends StatefulWidget {
  const SwipeCardStack({
    super.key,
    required this.itemCount,
    required this.itemBuilder,
    required this.onSwiped,
    this.canSwipe,
  });

  final int itemCount;
  final IndexedWidgetBuilder itemBuilder;

  /// Called after the top card (always index 0) has left the screen.
  final void Function(SwipeDirection direction) onSwiped;
  final SwipeGate? canSwipe;

  @override
  SwipeCardStackState createState() => SwipeCardStackState();
}

class SwipeCardStackState extends State<SwipeCardStack> with SingleTickerProviderStateMixin {
  static const double _threshold = 0.28;
  static const double _flingVelocity = 900;

  // Created eagerly: a lazy controller would first be built inside dispose() if the stack was never swiped.
  late final AnimationController _anim;
  Offset _drag = Offset.zero;
  Animation<Offset>? _flight;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 260));
  }

  @override
  void dispose() {
    _anim.dispose();
    super.dispose();
  }

  Offset get _offset => _flight?.value ?? _drag;

  /// Programmatic swipe (Pass / Like buttons).
  Future<void> swipe(SwipeDirection direction) async {
    if (_busy || widget.itemCount == 0) return;
    if (widget.canSwipe != null && !await widget.canSwipe!(direction)) return;
    await _flyOut(direction);
  }

  void _onUpdate(DragUpdateDetails d) {
    if (_busy) return;
    setState(() => _drag += Offset(d.delta.dx, d.delta.dy * 0.2));
  }

  Future<void> _onEnd(DragEndDetails d, double width) async {
    if (_busy) return;
    final vx = d.velocity.pixelsPerSecond.dx;
    SwipeDirection? direction;
    if (_drag.dx > width * _threshold || vx > _flingVelocity) direction = SwipeDirection.right;
    if (_drag.dx < -width * _threshold || vx < -_flingVelocity) direction = SwipeDirection.left;

    if (direction == null) return _springBack();
    _busy = true;
    final allowed = widget.canSwipe == null || await widget.canSwipe!(direction);
    _busy = false;
    if (!mounted) return;
    if (allowed) {
      await _flyOut(direction);
    } else {
      await _springBack();
    }
  }

  Future<void> _springBack() => _animateTo(Offset.zero, curve: Curves.easeOutBack);

  Future<void> _flyOut(SwipeDirection direction) async {
    final width = context.size?.width ?? 400;
    final target = Offset(direction == SwipeDirection.right ? width * 1.5 : -width * 1.5, _drag.dy);
    _busy = true;
    await _animateTo(target, curve: Curves.easeIn);
    if (!mounted) return;
    setState(() {
      _drag = Offset.zero;
      _flight = null;
    });
    _busy = false;
    widget.onSwiped(direction);
  }

  Future<void> _animateTo(Offset target, {required Curve curve}) async {
    _flight = Tween<Offset>(begin: _drag, end: target).animate(CurvedAnimation(parent: _anim, curve: curve));
    _anim
      ..reset()
      ..addListener(_tick);
    await _anim.forward();
    _anim.removeListener(_tick);
    if (!mounted) return;
    setState(() {
      _drag = target;
      _flight = null;
    });
  }

  void _tick() => setState(() {});

  @override
  Widget build(BuildContext context) {
    if (widget.itemCount == 0) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final offset = _offset;
        final progress = (offset.dx / (width * _threshold)).clamp(-1.0, 1.0);
        return Stack(
          fit: StackFit.expand,
          children: <Widget>[
            if (widget.itemCount > 1)
              Transform.scale(
                scale: 0.95 + 0.05 * progress.abs(),
                child: IgnorePointer(child: widget.itemBuilder(context, 1)),
              ),
            GestureDetector(
              key: const Key('top-card'),
              onHorizontalDragUpdate: _onUpdate,
              onHorizontalDragEnd: (d) => _onEnd(d, width),
              child: Transform.translate(
                offset: offset,
                child: Transform.rotate(
                  angle: (offset.dx / width) * math.pi / 12,
                  child: Stack(
                    fit: StackFit.expand,
                    children: <Widget>[
                      widget.itemBuilder(context, 0),
                      if (progress > 0.15) _Stamp(text: 'LIKE', color: RoseColors.champagneGold, opacity: progress),
                      if (progress < -0.15)
                        _Stamp(text: 'PASS', color: RoseColors.warmIvory, opacity: -progress, alignRight: true),
                    ],
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _Stamp extends StatelessWidget {
  const _Stamp({required this.text, required this.color, required this.opacity, this.alignRight = false});

  final String text;
  final Color color;
  final double opacity;
  final bool alignRight;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: alignRight ? Alignment.topRight : Alignment.topLeft,
      child: Padding(
        padding: const EdgeInsets.all(RoseSpacing.s6),
        child: Opacity(
          opacity: opacity.clamp(0, 1),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: RoseSpacing.s3, vertical: RoseSpacing.s1),
            decoration: BoxDecoration(
              border: Border.all(color: color, width: 3),
              borderRadius: BorderRadius.circular(RoseRadius.sm),
            ),
            child: Text(text, style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: color)),
          ),
        ),
      ),
    );
  }
}
