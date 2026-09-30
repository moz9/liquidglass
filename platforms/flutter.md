# Flutter (iOS, Android, Web, Windows, macOS, Linux)

> Сниппеты исходной реализации: перед переносом прочитай [актуальный маршрут](../docs/emulation.md) и [чек-лист](../docs/08-checklist.md). Сверяй API с целевым SDK; таблицы возможностей и числа ниже не доказывают работу на конкретном устройстве.

| Уровень | Как | Где |
|---|---|---|
| T0 | `DecoratedBox` с solid-заливкой, rim, внешней тенью | всегда доступно |
| T1 | `BackdropFilter` (blur + ColorFilter-насыщенность) + заливка + rim + тень | Skia и Impeller |
| T2 | + `ImageFilter.shader` с рефракцией | только **Impeller** (`ImageFilter.isShaderFilterSupported`) |
| T3 | слияние капель и т. п. | пакет `liquid_glass_renderer` или свой `CustomPainter` + `FragmentShader` над своим фоном |

На iOS 26+ нативный материал ближе всего к оригиналу: для баров можно встроить `UiKitView` с `UIVisualEffectView(effect: UIGlassEffect())` (platform view, есть стоимость композиции) — или проверь, не появились ли в экосистеме готовые обёртки нативного стекла.

## 1. Базовый виджет (T0/T1)

```dart
import 'dart:ui';
import 'package:flutter/material.dart';

class GlassStyle {
  const GlassStyle({required this.fill, required this.rim, required this.shadows,
                    this.blur = 10, this.saturation = 1.8, this.live = true});
  final Color fill;
  final List<Color> rim;            // lit, side, side, opposite (стопы 0, .34, .66, 1)
  final List<BoxShadow> shadows;
  final double blur;                // σ
  final double saturation;
  final bool live;                  // false = T0 (без backdrop)

  static const _lightShadows = [
    BoxShadow(color: Color(0x2E000000), offset: Offset(0, 10), blurRadius: 30, spreadRadius: -6),
    BoxShadow(color: Color(0x14000000), offset: Offset(0, 2), blurRadius: 8),
  ];
  static const _darkShadows = [
    BoxShadow(color: Color(0x80000000), offset: Offset(0, 12), blurRadius: 36, spreadRadius: -6),
    BoxShadow(color: Color(0x4D000000), offset: Offset(0, 2), blurRadius: 8),
  ];

  static GlassStyle regular(Brightness b) => b == Brightness.dark
      ? const GlassStyle(fill: Color(0x5C1E1E22), shadows: _darkShadows,
          rim: [Color(0x80FFFFFF), Color(0x0FFFFFFF), Color(0x0FFFFFFF), Color(0x3DFFFFFF)])
      : const GlassStyle(fill: Color(0x33FFFFFF), shadows: _lightShadows,
          rim: [Color(0xE6FFFFFF), Color(0x24FFFFFF), Color(0x24FFFFFF), Color(0x80FFFFFF)]);

  static GlassStyle solid(Brightness b) => regular(b).copyWith(
      live: false, fill: b == Brightness.dark ? const Color(0xF71C1C1E) : const Color(0xF7F9F9FB));

  GlassStyle copyWith({Color? fill, bool? live}) => GlassStyle(
      fill: fill ?? this.fill, rim: rim, shadows: shadows, blur: blur, saturation: saturation, live: live ?? this.live);
}

class LiquidGlass extends StatelessWidget {
  const LiquidGlass({super.key, required this.child, required this.style, this.radius = 999, this.lens});
  final Widget child;
  final GlassStyle style;
  final double radius;               // 999 → капсула (обрезается до h/2)
  final ImageFilter? lens;           // T2: ImageFilter.shader(...) — см. §2

  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(radius);   // 999 → движок сам ужмёт радиус до h/2 (капсула)
    final frosted = ImageFilter.compose(
      outer: ColorFilter.matrix(_saturation(style.saturation)),
      inner: ImageFilter.blur(sigmaX: style.blur, sigmaY: style.blur, tileMode: TileMode.clamp),
    );
    Widget body = DecoratedBox(decoration: BoxDecoration(color: style.fill, borderRadius: r), child: child);
    if (style.live) {
      body = BackdropFilter(                   // 3.29+: BackdropFilter.grouped внутри BackdropGroup
        filter: lens == null ? frosted : ImageFilter.compose(outer: lens!, inner: frosted),
        child: body,
      );
    }
    return CustomPaint(
      painter: _OuterShadowPainter(r, style.shadows),              // тень ТОЛЬКО снаружи формы
      foregroundPainter: _RimPainter(r, style.rim),                // блик поверх контента
      child: ClipRRect(borderRadius: r, child: body),              // без клипа размоется весь экран
    );
  }

  static List<double> _saturation(double s) {
    const r = 0.2126, g = 0.7152, b = 0.0722;
    return [
      r + (1 - r) * s, g - g * s, b - b * s, 0, 0,
      r - r * s, g + (1 - g) * s, b - b * s, 0, 0,
      r - r * s, g - g * s, b + (1 - b) * s, 0, 0,
      0, 0, 0, 1, 0,
    ];
  }
}

/// BoxShadow под полупрозрачным стеклом попал бы в backdrop и затемнил его — рисуем тень только снаружи.
class _OuterShadowPainter extends CustomPainter {
  _OuterShadowPainter(this.radius, this.shadows);
  final BorderRadius radius;
  final List<BoxShadow> shadows;

  @override
  void paint(Canvas canvas, Size size) {
    final shape = radius.toRRect(Offset.zero & size);
    canvas.save();
    canvas.clipPath(Path.combine(PathOperation.difference,
        Path()..addRect((Offset.zero & size).inflate(200)), Path()..addRRect(shape)));
    for (final s in shadows) {
      canvas.drawRRect(shape.shift(s.offset).inflate(s.spreadRadius), s.toPaint());
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_OuterShadowPainter old) => old.radius != radius || old.shadows != shadows;
}

class _RimPainter extends CustomPainter {
  _RimPainter(this.radius, this.colors);
  final BorderRadius radius;
  final List<Color> colors;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..shader = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight,
          colors: colors, stops: const [0, .34, .66, 1]).createShader(rect);
    canvas.drawRRect(radius.toRRect(rect).deflate(0.5), paint);
  }

  @override
  bool shouldRepaint(_RimPainter old) => old.radius != radius || old.colors != colors;
}
```

Оптимизация для Flutter 3.29+: оберни экран в `BackdropGroup` и замени `BackdropFilter` на `BackdropFilter.grouped` — все стеклянные элементы на одном фоне будут делить одну выборку backdrop. Непрерывные углы (суперэллипс) — `ClipRSuperellipse`/`RSuperellipse` (Flutter 3.32+) вместо `ClipRRect` для не-капсул.

## 2. Рефракция (T2, Impeller)

Шейдер: [`reference/shaders/liquid_glass.frag`](../reference/shaders/liquid_glass.frag).

```yaml
# pubspec.yaml
flutter:
  shaders:
    - shaders/liquid_glass.frag
```

```dart
late final FragmentProgram _program;
Future<void> loadGlassShader() async => _program = await FragmentProgram.fromAsset('shaders/liquid_glass.frag');

ImageFilter? lensFilter(Rect globalRect, double radius, double dpr) {
  if (!ImageFilter.isShaderFilterSupported) return null;          // Skia-бэкенд → T1
  final minSide = globalRect.shortestSide;
  final bezel = (minSide * 0.35).clamp(8.0, 24.0).clamp(0.0, minSide / 2);
  final shader = _program.fragmentShader()
    ..setFloat(2, globalRect.left * dpr)  ..setFloat(3, globalRect.top * dpr)
    ..setFloat(4, globalRect.width * dpr) ..setFloat(5, globalRect.height * dpr)
    ..setFloat(6, radius * dpr)           ..setFloat(7, bezel * dpr)
    ..setFloat(8, bezel * dpr)            // strength = bezel
    ..setFloat(9, 1.5)                    // IOR
    ..setFloat(10, 3)                     // profile
    ..setFloat(11, 0)                     // aberration (T3: 0.08)
    ..setFloat(12, 0);                    // debug: 1 = показать SDF
  return ImageFilter.shader(shader);
}
```

`globalRect` — положение виджета (`RenderBox.localToGlobal`), обновляй при изменении layout. **Калибровка:** один раз включи `debug = 1`: красная форма должна лечь ровно под виджет. Если движок передаёт в шейдер только область клипа, координаты будут локальными — тогда `left/top = 0`. На OpenGL-бэкенде Impeller ось Y может быть перевёрнута — проверь тем же debug-режимом.

Готовая альтернатива с рефракцией и слиянием капель: пакет **`liquid_glass_renderer`** (pub.dev) — проверь поддерживаемые платформы и версию Flutter перед использованием.

## 3. Движение

```dart
// Пружины из токенов: stiffness/damping — `node tools/spring.mjs --tokens`
const press   = SpringDescription(mass: 1, stiffness: 815.7, damping: 37.13);
const release = SpringDescription(mass: 1, stiffness: 273.4, damping: 18.19);
const snappy  = SpringDescription(mass: 1, stiffness: 438.6, damping: 35.60);
const morph   = SpringDescription(mass: 1, stiffness: 223.8, damping: 23.34);

class GlassButton extends StatefulWidget {
  const GlassButton({super.key, required this.child, this.onPressed});
  final Widget child;
  final VoidCallback? onPressed;
  @override
  State<GlassButton> createState() => _GlassButtonState();
}

class _GlassButtonState extends State<GlassButton> with SingleTickerProviderStateMixin {
  late final AnimationController _scale = AnimationController.unbounded(vsync: this, value: 1);

  void _animate(double target, SpringDescription spring) =>
      // animateWith стартует с текущей скорости → прерываемо и упруго
      _scale.animateWith(SpringSimulation(spring, _scale.value, target, _scale.velocity));

  @override
  void dispose() {
    _scale.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.disableAnimationsOf(context);
    return GestureDetector(
      onTapDown: (_) => reduce ? null : _animate(1.1, press),
      onTapUp: (_) => _animate(1, release),
      onTapCancel: () => _animate(1, release),
      onTap: widget.onPressed,
      child: AnimatedBuilder(
        animation: _scale,
        builder: (_, child) => Transform.scale(scale: _scale.value, child: child),
        child: LiquidGlass(style: GlassStyle.regular(Theme.of(context).brightness), child: widget.child),
      ),
    );
  }
}
```

- `AnimationController.unbounded` — чтобы значение могло перелетать за 1.0.
- **Капля-индикатор:** два `AnimationController.unbounded` (левый/правый край) со `SpringSimulation` lead (685.4 / 41.89) и trail (223.8 / 22.14); рисуй индикатор в `CustomPainter` по двум значениям — без перестройки layout.
- **Морфинг:** `Hero` с `flightShuttleBuilder` и `createRectTween` на пружине, или свой FLIP через `AnimatedBuilder` (как в [05-motion.md](../docs/05-motion.md#6-морфинг-кнопка--меню--поповер--поле)).
- Ripple Material отключи: `splashFactory: NoSplash.splashFactory`, `highlightColor: Colors.transparent` — вместо него свечение из точки касания (радиальный градиент в `foregroundPainter`).

## 4. Доступность и уровни

```dart
int glassTier(BuildContext context, {bool userPrefersSolid = false}) {
  if (userPrefersSolid || MediaQuery.highContrastOf(context)) return 0;
  return ImageFilter.isShaderFilterSupported ? 2 : 1;
}
```

- Reduce Transparency не экспонируется в `MediaQuery`: на iOS прочитай `UIAccessibility.isReduceTransparencyEnabled` через platform channel, на других платформах — настройка приложения.
- `MediaQuery.disableAnimationsOf` → пружины с ζ = 1, без растяжений.
- Просадки: `SchedulerBinding.instance.addTimingsCallback` → при устойчивом превышении бюджета растеризации понижай уровень.

## 5. Desktop и Web

- **Windows/macOS окно:** пакет `flutter_acrylic` (`Window.setEffect(effect: WindowEffect.mica)` на Windows 11, vibrancy на macOS); на macOS 26+ окно и тулбар лучше сделать нативными.
- **Flutter Web:** `BackdropFilter` работает (CanvasKit/Skwasm), `ImageFilter.shader` — проверь `isShaderFilterSupported`; для веб-проекта без Flutter используй [web.md](web.md).
