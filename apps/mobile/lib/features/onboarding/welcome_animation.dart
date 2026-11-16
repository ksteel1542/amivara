import 'dart:io' show Platform;
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../theme/rose_tokens.g.dart';

/// Whether the welcome scene animates. Off under `flutter test` (an endless loop
/// never "settles"), and tests that check the motion turn it on.
final welcomeMotionProvider = Provider<bool>((ref) => !Platform.environment.containsKey('FLUTTER_TEST'));

/// One loop of the intro: birds fly in, meet, become a glowing heart, burst, rest.
const Duration kWelcomeLoop = Duration(milliseconds: 9000);

/// The love lines that float and dissolve over the scene, one after another.
const List<String> kWelcomeLines = <String>[
  'Welcome to AMIVARA',
  'Where Real Love Takes Flight',
  'Connect with Magic',
  'Your Story Starts Here',
];

/// The animated welcome hero: a shifting rose-gold and burgundy sky, two love
/// birds that fly together and become a glowing heart, a burst of confetti and
/// sparkling dust, and love lines floating through. Loops forever; a still
/// frame (the heart) when the phone asks for reduced motion.
class WelcomeAnimation extends ConsumerStatefulWidget {
  const WelcomeAnimation({super.key});

  @override
  ConsumerState<WelcomeAnimation> createState() => _WelcomeAnimationState();
}

class _WelcomeAnimationState extends ConsumerState<WelcomeAnimation> with SingleTickerProviderStateMixin {
  late final AnimationController _loop = AnimationController(vsync: this, duration: kWelcomeLoop);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final animate = ref.read(welcomeMotionProvider) && !MediaQuery.of(context).disableAnimations;
    if (animate && !_loop.isAnimating) {
      _loop.repeat();
    } else if (!animate) {
      _loop
        ..stop()
        ..value = 0.55; // the glowing heart
    }
  }

  @override
  void dispose() {
    _loop.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      key: const Key('welcome-animation'),
      label: 'Two love birds fly together and become a glowing heart. Welcome to AMIVARA.',
      image: true,
      child: AnimatedBuilder(
        animation: _loop,
        builder: (context, _) {
          final t = _loop.value;
          return Stack(
            fit: StackFit.expand,
            children: <Widget>[
              RepaintBoundary(child: CustomPaint(painter: _ScenePainter(t))),
              // Wordmark at the top.
              Align(
                alignment: const Alignment(0, -0.78),
                child: ExcludeSemantics(
                  child: Text(
                    'AMIVARA',
                    style: RoseType.headlineLarge.copyWith(
                      color: RoseColors.warmIvory,
                      letterSpacing: 8,
                      shadows: <Shadow>[
                        Shadow(blurRadius: 18, color: RoseColors.champagneGold.withValues(alpha: 0.55)),
                      ],
                    ),
                  ),
                ),
              ),
              Align(
                alignment: const Alignment(0, 0.86),
                child: _LoveLine(t: t),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// The love lines: each one drifts up, glows in and dissolves, in turn.
class _LoveLine extends StatelessWidget {
  const _LoveLine({required this.t});

  final double t;

  @override
  Widget build(BuildContext context) {
    final slot = 1 / kWelcomeLines.length;
    final i = (t / slot).floor().clamp(0, kWelcomeLines.length - 1);
    final local = (t - i * slot) / slot; // 0..1 within this line
    final opacity = local < 0.2
        ? Curves.easeOut.transform(local / 0.2)
        : local > 0.8
        ? 1 - Curves.easeIn.transform((local - 0.8) / 0.2)
        : 1.0;
    final rise = (1 - local) * 14;
    final blur = (1 - opacity) * 6;
    return ExcludeSemantics(
      child: Transform.translate(
        offset: Offset(0, rise),
        child: Opacity(
          opacity: opacity.clamp(0, 1),
          child: ImageFiltered(
            imageFilter: ui.ImageFilter.blur(sigmaX: blur, sigmaY: blur),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Text(
                kWelcomeLines[i],
                key: const Key('welcome-love-line'),
                textAlign: TextAlign.center,
                style: RoseType.headlineSmall.copyWith(
                  color: RoseColors.warmIvory,
                  fontStyle: FontStyle.italic,
                  shadows: const <Shadow>[Shadow(blurRadius: 10, color: Color(0x88000000))],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

double _seg(double t, double a, double b) => ((t - a) / (b - a)).clamp(0.0, 1.0);

class _Particle {
  const _Particle(this.angle, this.speed, this.size, this.color, this.kind, this.spin);

  final double angle;
  final double speed;
  final double size;
  final Color color;

  /// 0 heart, 1 dot, 2 sparkle
  final int kind;
  final double spin;
}

final List<_Particle> _burst = () {
  final rnd = math.Random(7);
  const colors = <Color>[
    RoseColors.champagneGold,
    RoseColors.rose300,
    RoseColors.rose100,
    RoseColors.warmIvory,
    Color(0xFFFF6F91),
  ];
  return List<_Particle>.generate(70, (i) {
    return _Particle(
      rnd.nextDouble() * math.pi * 2,
      0.35 + rnd.nextDouble() * 0.65,
      3 + rnd.nextDouble() * 6,
      colors[i % colors.length],
      i % 3,
      (rnd.nextDouble() - 0.5) * 8,
    );
  });
}();

final List<Offset> _dust = () {
  final rnd = math.Random(11);
  return List<Offset>.generate(46, (_) => Offset(rnd.nextDouble(), rnd.nextDouble()));
}();

class _ScenePainter extends CustomPainter {
  _ScenePainter(this.t);

  /// Position in the loop, 0..1.
  final double t;

  // Timeline (fractions of the loop).
  static const double flyEnd = 0.30;
  static const double mergeEnd = 0.40;
  static const double burstEnd = 0.75;
  static const double fadeStart = 0.88;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height * 0.46);
    final unit = math.min(size.width, size.height);
    final heartIn = Curves.easeOutBack.transform(_seg(t, flyEnd, mergeEnd));
    final heartOut = 1 - Curves.easeIn.transform(_seg(t, fadeStart, 1));
    final heartLevel = heartIn * heartOut;
    final beat = 1 + 0.06 * math.sin(t * math.pi * 2 * 6) * heartLevel;

    _sky(canvas, size, center, unit, heartLevel);
    _sparkleDust(canvas, size);
    _birds(canvas, center, unit);
    _heart(canvas, center + Offset(0, unit * 0.04), unit * 0.25 * beat, heartLevel);
    _confetti(canvas, center + Offset(0, unit * 0.04), unit);
  }

  /// Rose-gold to burgundy, slowly shifting, with a glow that swells with the heart.
  void _sky(Canvas canvas, Size size, Offset center, double unit, double heartLevel) {
    final drift = math.sin(t * math.pi * 2);
    final rect = Offset.zero & size;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment(-1 + drift * 0.6, -1),
          end: Alignment(1 - drift * 0.6, 1),
          colors: <Color>[
            Color.lerp(const Color(0xFFB76E79), RoseColors.rose700, 0.5 + drift * 0.3)!, // rose gold
            RoseColors.burgundy,
            RoseColors.burgundy950,
          ],
          stops: const <double>[0, 0.55, 1],
        ).createShader(rect),
    );
    canvas.drawCircle(
      center,
      unit * (0.45 + 0.15 * heartLevel),
      Paint()
        ..shader = RadialGradient(
          colors: <Color>[
            RoseColors.rose300.withValues(alpha: 0.18 + 0.32 * heartLevel),
            RoseColors.rose300.withValues(alpha: 0),
          ],
        ).createShader(Rect.fromCircle(center: center, radius: unit * 0.6)),
    );
  }

  /// Gold dust that twinkles all the time.
  void _sparkleDust(Canvas canvas, Size size) {
    for (var i = 0; i < _dust.length; i++) {
      final p = _dust[i];
      final twinkle = 0.5 + 0.5 * math.sin((t * 2 * math.pi * 3) + i * 1.7);
      final pos = Offset(p.dx * size.width, (p.dy * size.height - t * 30 * (1 + i % 3)) % size.height);
      _sparkle(canvas, pos, 1.2 + 2.2 * twinkle, RoseColors.champagneGold.withValues(alpha: 0.15 + 0.55 * twinkle));
    }
  }

  /// Two birds flap in from either side, meet (and the heart blooms between them),
  /// then perch on either side of it, and fly off as the loop ends.
  void _birds(Canvas canvas, Offset center, double unit) {
    final flyIn = Curves.easeInOutCubic.transform(_seg(t, 0, flyEnd));
    final release = Curves.easeOutCubic.transform(_seg(t, flyEnd, mergeEnd + 0.04));
    final flyOff = Curves.easeInCubic.transform(_seg(t, fadeStart, 1));
    final perched = t > mergeEnd + 0.04 && t < fadeStart;
    // Fast wingbeats in flight, slow ones while perched.
    final flap = math.sin(t * math.pi * 2 * (perched ? 5 : 14));
    final bob = perched ? math.sin(t * math.pi * 2 * 3) * unit * 0.012 : 0.0;
    for (final side in <int>[-1, 1]) {
      final start = Offset(center.dx + side * unit * 0.62, center.dy - unit * 0.12);
      final meet = Offset(center.dx + side * unit * 0.13, center.dy - unit * 0.05);
      final perch = Offset(center.dx + side * unit * 0.37, center.dy - unit * 0.02);
      final gone = Offset(center.dx + side * unit * 0.85, center.dy - unit * 0.30);
      Offset pos;
      if (t <= flyEnd) {
        pos = Offset.lerp(start, meet, flyIn)! - Offset(0, math.sin(flyIn * math.pi) * unit * 0.10);
      } else if (t < fadeStart) {
        pos = Offset.lerp(meet, perch, release)! + Offset(0, bob);
      } else {
        pos = Offset.lerp(perch, gone, flyOff)!;
      }
      final alpha = (t < 0.04 ? t / 0.04 : 1.0) * (1 - flyOff);
      if (alpha <= 0.01) continue;
      canvas.save();
      canvas.translate(pos.dx, pos.dy);
      // Facing each other; while they hold the heart between them, they lean in.
      canvas.scale(-side.toDouble(), 1);
      canvas.rotate(-0.18 * math.sin(release * math.pi));
      _bird(canvas, unit * 0.17, flap, alpha);
      canvas.restore();
    }
  }

  void _bird(Canvas canvas, double s, double flap, double alpha) {
    final body = Path()
      ..moveTo(-0.55 * s, 0.05 * s)
      ..quadraticBezierTo(-0.15 * s, -0.42 * s, 0.38 * s, -0.12 * s)
      ..quadraticBezierTo(0.52 * s, 0.02 * s, 0.30 * s, 0.14 * s)
      ..quadraticBezierTo(-0.10 * s, 0.30 * s, -0.55 * s, 0.05 * s)
      ..close();
    final tail = Path()
      ..moveTo(-0.50 * s, 0.04 * s)
      ..lineTo(-0.85 * s, -0.12 * s)
      ..lineTo(-0.78 * s, 0.10 * s)
      ..lineTo(-0.88 * s, 0.24 * s)
      ..close();
    final wingLift = flap * 0.38 * s;
    final wing = Path()
      ..moveTo(-0.10 * s, -0.08 * s)
      ..quadraticBezierTo(-0.05 * s, -0.55 * s - wingLift, 0.22 * s, -0.70 * s - wingLift)
      ..quadraticBezierTo(0.12 * s, -0.30 * s, 0.18 * s, -0.10 * s)
      ..close();
    final fill = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: <Color>[RoseColors.warmIvory, RoseColors.rose100, RoseColors.rose300],
      ).createShader(Rect.fromCircle(center: Offset.zero, radius: s))
      ..color = Colors.white.withValues(alpha: alpha);
    final glow = Paint()
      ..color = RoseColors.champagneGold.withValues(alpha: 0.45 * alpha)
      ..maskFilter = MaskFilter.blur(BlurStyle.normal, s * 0.08)
      ..style = PaintingStyle.stroke
      ..strokeWidth = s * 0.05;
    for (final p in <Path>[tail, body, wing]) {
      canvas.drawPath(p, glow);
      canvas.drawPath(p, fill);
    }
    canvas.drawPath(
      wing,
      Paint()
        ..color = RoseColors.champagneGold.withValues(alpha: 0.8 * alpha)
        ..style = PaintingStyle.stroke
        ..strokeWidth = s * 0.02,
    );
    // Eye and beak.
    canvas.drawCircle(Offset(0.28 * s, -0.08 * s), s * 0.035, Paint()..color = RoseColors.burgundy950);
    canvas.drawPath(
      Path()
        ..moveTo(0.44 * s, -0.06 * s)
        ..lineTo(0.58 * s, -0.01 * s)
        ..lineTo(0.43 * s, 0.03 * s)
        ..close(),
      Paint()..color = RoseColors.champagneGold,
    );
  }

  /// The heart the birds become: rose to gold, glowing, beating.
  void _heart(Canvas canvas, Offset center, double r, double level) {
    if (level <= 0.01) return;
    final path = _heartPath(center, r * level);
    canvas.drawPath(
      path,
      Paint()
        ..color = const Color(0xFFFF6F91).withValues(alpha: 0.55 * level)
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, r * 0.35),
    );
    canvas.drawPath(
      path,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[Color(0xFFFFB3C6), Color(0xFFE5486F), RoseColors.rose800],
        ).createShader(Rect.fromCircle(center: center, radius: r)),
    );
    canvas.drawPath(
      path,
      Paint()
        ..color = RoseColors.champagneGold.withValues(alpha: 0.9 * level)
        ..style = PaintingStyle.stroke
        ..strokeWidth = r * 0.05,
    );
    // A highlight, like light on glass.
    canvas.drawOval(
      Rect.fromCenter(center: center + Offset(-r * 0.38, -r * 0.42), width: r * 0.34, height: r * 0.2),
      Paint()..color = Colors.white.withValues(alpha: 0.45 * level),
    );
  }

  Path _heartPath(Offset c, double r) {
    return Path()
      ..moveTo(c.dx, c.dy + r * 0.85)
      ..cubicTo(c.dx - r * 1.35, c.dy + r * 0.05, c.dx - r * 0.95, c.dy - r * 1.05, c.dx, c.dy - r * 0.42)
      ..cubicTo(c.dx + r * 0.95, c.dy - r * 1.05, c.dx + r * 1.35, c.dy + r * 0.05, c.dx, c.dy + r * 0.85)
      ..close();
  }

  /// Confetti, tiny hearts and sparkles bursting out of the heart, falling gently.
  void _confetti(Canvas canvas, Offset center, double unit) {
    final p = _seg(t, flyEnd + 0.05, burstEnd);
    if (p <= 0 || p >= 1) return;
    final ease = Curves.easeOutCubic.transform(p);
    final alpha = 1 - Curves.easeIn.transform(p);
    for (final particle in _burst) {
      final distance = particle.speed * unit * 0.7 * ease;
      final gravity = unit * 0.25 * p * p;
      final pos = center + Offset(math.cos(particle.angle) * distance, math.sin(particle.angle) * distance + gravity);
      final color = particle.color.withValues(alpha: alpha);
      switch (particle.kind) {
        case 0:
          canvas.drawPath(_heartPath(pos, particle.size * 1.3), Paint()..color = color);
        case 1:
          canvas.drawCircle(pos, particle.size * 0.45, Paint()..color = color);
        default:
          canvas.save();
          canvas.translate(pos.dx, pos.dy);
          canvas.rotate(particle.spin * p);
          _sparkle(canvas, Offset.zero, particle.size, color);
          canvas.restore();
      }
    }
  }

  void _sparkle(Canvas canvas, Offset c, double r, Color color) {
    final path = Path()
      ..moveTo(c.dx, c.dy - r)
      ..quadraticBezierTo(c.dx, c.dy, c.dx + r, c.dy)
      ..quadraticBezierTo(c.dx, c.dy, c.dx, c.dy + r)
      ..quadraticBezierTo(c.dx, c.dy, c.dx - r, c.dy)
      ..quadraticBezierTo(c.dx, c.dy, c.dx, c.dy - r)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_ScenePainter old) => old.t != t;
}
