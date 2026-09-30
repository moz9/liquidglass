# Кроссплатформенные стеки и движки

> Сниппеты исходной реализации: перед переносом прочитай [актуальный маршрут](../docs/emulation.md) и [чек-лист](../docs/08-checklist.md). Сверяй API с целевым SDK; таблицы возможностей и числа ниже не доказывают работу на конкретном устройстве.

React Native / Expo, .NET MAUI, Qt 6 / QML, Compose Multiplatform, Linux (GTK, KDE), Electron/Tauri, Unity, Unreal, Godot. Flutter — отдельно: [flutter.md](flutter.md).

Общий принцип для всех кроссплатформенных стеков: **на iOS/macOS 26+ — нативное стекло через мост, на остальных платформах — T1/T2-имитация по гайдам платформы.** Один компонент `Glass` в коде приложения, разные реализации внутри.

## React Native / Expo

| Платформа | Реализация |
|---|---|
| iOS 26+ | нативный `UIGlassEffect`: `expo-glass-effect` (`GlassView`, `GlassContainer`, `isLiquidGlassAvailable()`) или `@callstack/liquid-glass` (`LiquidGlassView`, `LiquidGlassContainerView`) |
| iOS < 26 | `expo-blur` `BlurView` (`tint="systemUltraThinMaterial"`) + rim + тень |
| Android | `expo-blur` с Android-методом размытия (`experimentalBlurMethod`, см. документацию версии) или `@react-native-community/blur`; API < 31 — полупрозрачная заливка |
| Рефракция (T2) над своим фоном | React Native Skia: `<BackdropFilter filter={<RuntimeShader source={…} />}>` — видит только то, что нарисовано в Skia `Canvas` (фото, градиенты), не RN-вью |

```tsx
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

export function Glass({ style, children, interactive, ...rest }: ViewProps & { interactive?: boolean }) {
  if (Platform.OS === 'ios' && isLiquidGlassAvailable()) {
    return <GlassView glassEffectStyle="regular" isInteractive={interactive} style={[styles.shape, style]} {...rest}>{children}</GlassView>;
  }
  return (
    <View style={[styles.shape, styles.shadow, style]} {...rest}>
      <BlurView intensity={40} tint="systemUltraThinMaterial" style={[StyleSheet.absoluteFill, styles.clip]} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, styles.fillAndRim]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  shape: { borderRadius: 999 },
  clip: { borderRadius: 999, overflow: 'hidden' },
  fillAndRim: { backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)' },
  shadow: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 15, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
});
```

Имена пропсов нативных обёрток меняются между версиями — сверяйся с README установленного пакета. Для градиентного rim вместо `borderColor` — `react-native-svg` (`<Rect stroke="url(#rim)">`) или Skia.

**Движение:** Reanimated `withSpring(v, { mass: 1, stiffness, damping, velocity })` — значения из `tools/spring.mjs`; жесты — Gesture Handler, скорость из `onEnd(e => e.velocityX)` передаётся в `velocity`. Анимации раскладки — `LinearTransition.springify().stiffness(…).damping(…)`. Анимируй `transform` в `useAnimatedStyle`, не `width/height`.

## .NET MAUI

Кастомный контрол `GlassView : ContentView` + handler с платформенными реализациями:

```csharp
public partial class GlassViewHandler : ContentViewHandler
{
#if IOS || MACCATALYST
    protected override Microsoft.Maui.Platform.ContentView CreatePlatformView()
    {
        var view = base.CreatePlatformView();
        UIKit.UIVisualEffect effect = OperatingSystem.IsIOSVersionAtLeast(26)
            ? new UIKit.UIGlassEffect()                                     // нативный Liquid Glass
            : UIKit.UIBlurEffect.FromStyle(UIKit.UIBlurEffectStyle.SystemUltraThinMaterial);
        var fx = new UIKit.UIVisualEffectView(effect) { AutoresizingMask = UIKit.UIViewAutoresizing.FlexibleDimensions };
        view.InsertSubview(fx, 0);
        return view;
    }
#elif WINDOWS
    // WinUI: GlassSurface из platforms/windows.md §2.2 на PlatformView
#elif ANDROID
    // API 31+: RenderEffect/BlurView-биндинг; ниже — полупрозрачная заливка
#endif
}
```

`UIGlassEffect` доступен, если workload .NET for iOS собран с Xcode 26 SDK — иначе оставь `UIBlurEffect`. Радиус, rim и тень — на MAUI-уровне (`Border` со `StrokeShape="RoundRectangle 22"` и `LinearGradientBrush` в `Stroke`, `Shadow`).

**Пружины в MAUI** (не прерываемые, но точные по форме): easing из переходной характеристики пружины.

```csharp
public static class SpringEasing
{
    public static (Easing Easing, uint Ms) Create(double response, double dampingRatio)
    {
        double w = 2 * Math.PI / response, z = dampingRatio;
        double X(double t)
        {
            if (z >= 1) return 1 - Math.Exp(-w * t) * (1 + w * t);
            double wd = w * Math.Sqrt(1 - z * z);
            return 1 - Math.Exp(-z * w * t) * (Math.Cos(wd * t) + z * w / wd * Math.Sin(wd * t));
        }
        double settle = 0;
        for (double t = 0; t < 10; t += 0.001) if (Math.Abs(1 - X(t)) > 0.001) settle = t;
        return (new Easing(p => X(p * settle)), (uint)Math.Round(settle * 1000));
    }
}

var (press, ms) = SpringEasing.Create(0.22, 0.65);
await glass.ScaleTo(1.1, ms, press);
```

Тот же приём (easing из пружины) подходит для любого фреймворка с easing-функциями и без физических пружин.

## Qt 6 / QML

**T1: `MultiEffect` над копией фона** (Qt 6.5+):

```qml
import QtQuick
import QtQuick.Effects

Item {
    id: root
    Item { id: content; anchors.fill: parent /* экран, список, фото */ }

    ShaderEffectSource {
        id: backdrop
        sourceItem: content
        sourceRect: Qt.rect(glass.x, glass.y, glass.width, glass.height)
        live: true
        visible: false
    }
    Item {
        id: glassMask
        width: glass.width; height: glass.height
        layer.enabled: true
        visible: false
        Rectangle { anchors.fill: parent; radius: height / 2 }
    }

    Item {
        id: glass
        width: 320; height: 62
        anchors { horizontalCenter: parent.horizontalCenter; bottom: parent.bottom; bottomMargin: 12 }

        MultiEffect {                                   // тень — отдельным MultiEffect/RectangularShadow под стеклом
            anchors.fill: parent
            source: backdrop
            blurEnabled: true; blurMax: 20; blur: 0.5   // ≈ σ 10: подбери по скриншоту
            saturation: 0.6                             // > 0 — насыщеннее; подбери до вида «×1.8»
            maskEnabled: true; maskSource: glassMask
        }
        Rectangle {                                     // fill + rim
            anchors.fill: parent; radius: height / 2
            color: Qt.rgba(1, 1, 1, 0.2)
            border.width: 1; border.color: Qt.rgba(1, 1, 1, 0.55)   // градиентный rim — Shape + LinearGradient
        }
    }
}
```

**T2: рефракция** — `ShaderEffect` с шейдером, скомпилированным `qt_add_shaders` (`.qsb`). Функции `sdRoundRect`, `profileH`, `deflection` — из [`reference/shaders/liquid-glass.agsl`](../reference/shaders/liquid-glass.agsl) (переименуй типы `float2 → vec2`):

```glsl
#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;          // px
    float radius;
    float bezel;
    float strength;
    float ior;
    float profile;
};
layout(binding = 1) uniform sampler2D source;   // размытый backdrop (MultiEffect → layer) или ShaderEffectSource

// ... sdRoundRect / profileH / deflection ...

void main() {
    vec2 p = qt_TexCoord0 * size;
    float d = sdRoundRect(p - size * 0.5, size * 0.5, radius);
    // n, t, off — как в эталоне
    fragColor = texture(source, (p + off) / size) * qt_Opacity;
}
```

**Движение:** точные пружины — `FrameAnimation` (Qt 6.4+) + интегратор:

```qml
FrameAnimation {
    id: spring
    property real target: 1; property real velocity: 0
    property real stiffness: 815.7; property real damping: 37.13     // токен press
    running: false
    onTriggered: {
        const a = -stiffness * (glass.scale - target) - damping * velocity
        velocity += a * frameTime; glass.scale += velocity * frameTime
        if (Math.abs(glass.scale - target) < 0.001 && Math.abs(velocity) < 0.01) { glass.scale = target; running = false }
    }
}
```

`SpringAnimation` в Qt имеет свою параметризацию (`spring`, `damping`, `mass`) — подбирай визуально, если не нужна точность. **Qt Widgets:** `QGraphicsBlurEffect` считает на CPU и тормозит — для стеклянного UI переходи на Qt Quick. Материал окна: Windows — `DwmSetWindowAttribute` на `winId()` (см. [windows.md](windows.md#31-окно-mica--acrylic-через-dwm-windows-11-22h2)), KDE — `KWindowEffects::enableBlurBehind`.

## Compose Multiplatform

См. [android.md](android.md#4-compose-multiplatform): Haze работает на Android, iOS, Desktop и Web; на iOS 26+ бары — нативные через `UIKitView`.

## Linux

- **GTK 4 / libadwaita:** в GTK CSS нет `backdrop-filter`. Живое стекло возможно только своей отрисовкой (`GtkSnapshot` + `gtk_snapshot_push_blur` над `GtkWidgetPaintable` фона) — дорого. Реалистичный путь: T0-стекло (solid, rim, тень, капсулы, пружины через `AdwSpringAnimation` с `AdwSpringParams(damping_ratio, mass, stiffness)`) или WebKitGTK/Flutter/Qt для стеклянных экранов.
- **KDE Plasma (Qt):** размытие *за окном* — `KWindowEffects::enableBlurBehind(window, true, region)` (KWin); внутри окна — QML-путь выше.
- **Wayland:** размытие за окном зависит от композитора (KWin — да, Mutter — нет). Всегда имей непрозрачный fallback.

## Electron и Tauri

Внутри окна — веб-эталон ([web.md](web.md)). Материал окна: Electron `backgroundMaterial` (Windows 11) / `vibrancy` (macOS); Tauri 2 — `windowEffects` или крейт `window-vibrancy`. На macOS и Linux Tauri использует WebKit → T1 без SVG-рефракции.

## Игровые движки

Стекло в игровых UI — это пост-эффект над кадром сцены: фон всегда доступен как текстура, поэтому T2/T3 здесь проще, чем в UI-фреймворках.

- **Godot 4:** шейдер [`reference/shaders/liquid-glass.gdshader`](../reference/shaders/liquid-glass.gdshader) на `ColorRect`/`Panel`: `hint_screen_texture` + `textureLod` (размытие мип-уровнем), рефракция, насыщенность, заливка, блик. `size_px` обновляй из скрипта при ресайзе.
- **Unity (URP):** включи Opaque Texture (или Renderer Feature с даунсэмплом и Kawase-blur в глобальную текстуру), UI-материал на Canvas в режиме Screen Space – Camera сэмплирует `_CameraOpaqueTexture` по `screenUV + offset` — SDF и рефракция как в GLSL-эталоне. Screen Space – Overlay не видит сцену: для него нужен свой Renderer Feature после рендера сцены.
- **Unreal:** T1 — UMG `BackgroundBlur` (сила размытия ≈ σ) + изображение-контур; T2 — UI-материалы не видят SceneColor, поэтому рефракцию делают через post-process материал с маской области виджета или через 3D-виджет с translucent-материалом (`SceneColor` + смещение UV).
- Для всех: слияние капель — `smin` нескольких SDF в одном шейдере ([03-optics.md](../docs/03-optics.md#2-слияние-капель-smooth-union)).
