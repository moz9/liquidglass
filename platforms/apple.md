# Apple: iOS, iPadOS, macOS, watchOS, tvOS, visionOS

## 0. Главное правило

На ОС 26+ (включая 27-ю линейку) **Liquid Glass — системный материал. Не имитируй его.** Пересборка с актуальным Xcode автоматически даёт стекло стандартным компонентам (таб-бары, тулбары, навбары, sheets, меню, поповеры, контролы). Твоя задача:

1. убрать то, что мешает стандартному стеклу (кастомные фоны баров);
2. для своих плавающих элементов применить `glassEffect` / `UIGlassEffect` / `NSGlassEffectView`;
3. собрать соседние стеклянные элементы в контейнеры (слияние, морфинг, производительность);
4. сделать backport для старых ОС через `if #available`.

> API ниже — из SDK 26. В SDK 27 они сохранены; прежде чем использовать *новые* модификаторы 27-й линейки, сверяйся с документацией установленного SDK. Не выдумывай API.

**Не добавляй** в Info.plist `UIDesignRequiresCompatibility = YES` (отключает Liquid Glass): Apple объявила ключ временным, и в новых SDK он перестаёт действовать.

## 1. Уберите то, что ломает стекло

- SwiftUI: `.toolbarBackground(.visible, …)`, `.toolbarBackground(Color…)`, фоны под `TabView`, `.presentationBackground(…)` у sheets — удалить.
- UIKit: `UINavigationBarAppearance().configureWithOpaqueBackground()`, `backgroundColor`/`barTintColor` у `UITabBar`/`UINavigationBar`/`UIToolbar`, кастомные `backgroundImage` — удалить или оставить только для iOS < 26.
- Свои «подложки» под плавающими кнопками (`Circle().fill(.ultraThinMaterial)`) на 26+ заменить на `glassEffect`.
- Контент должен идти под бары: не ограничивай `ScrollView` безопасной зоной вручную.

## 2. SwiftUI

### 2.1. Материал на своём элементе

```swift
Text("Liquid Glass")
    .padding(.horizontal, 18).frame(height: 44)
    .glassEffect()                                   // regular, форма — капсула

Image(systemName: "heart")
    .frame(width: 44, height: 44)
    .glassEffect(.regular.tint(.pink).interactive(), in: .circle)

VStack { … }
    .padding(20)
    .glassEffect(.regular, in: .rect(cornerRadius: 24))

// поверх фото/видео:
controls.glassEffect(.clear)
```

- `Glass.regular`, `.clear`, `.identity` (условно выключить стекло без перестройки иерархии).
- `.tint(_:)` — цвет *в* стекле (для главного/выбранного действия), `.interactive()` — набухание, свечение и упругость при касании (для контролов).

### 2.2. Кнопки

```swift
Button("Изменить") { }.buttonStyle(.glass)
Button("Готово") { }.buttonStyle(.glassProminent).tint(.blue)   // одно главное действие
```

### 2.3. Контейнер: слияние и морфинг

Соседние стеклянные элементы всегда помещай в `GlassEffectContainer`: они делят выборку фона (быстрее) и сливаются в каплю, если ближе `spacing`.

```swift
struct EditTools: View {
    @Namespace private var glass
    @State private var expanded = false

    var body: some View {
        GlassEffectContainer(spacing: 24) {
            HStack(spacing: 8) {
                Button { expanded.toggle() } label: { Image(systemName: "pencil") }
                    .frame(width: 44, height: 44)
                    .glassEffect(.regular.interactive())
                    .glassEffectID("pencil", in: glass)

                if expanded {
                    Button { } label: { Image(systemName: "eraser") }
                        .frame(width: 44, height: 44)
                        .glassEffect(.regular.interactive())
                        .glassEffectID("eraser", in: glass)   // вытекает из «карандаша»
                }
            }
        }
        .animation(.spring(response: 0.42, dampingFraction: 0.78), value: expanded) // токен morph
    }
}
```

- `.glassEffectID(_:in:)` + `@Namespace` — морфинг формы между состояниями.
- `.glassEffectUnion(id:namespace:)` — объединить удалённые друг от друга элементы в одну стеклянную форму.
- `.glassEffectTransition(.matchedGeometry)` (по умолчанию) или `.materialize` для появления.

### 2.4. Навигация

```swift
TabView {
    Tab("Главная", systemImage: "house") { HomeView() }
    Tab("Обзор", systemImage: "square.grid.2x2") { BrowseView() }
    Tab(role: .search) { SearchView() }          // отдельная круглая кнопка поиска
}
.tabBarMinimizeBehavior(.onScrollDown)            // сворачивание при прокрутке
.tabViewBottomAccessory { NowPlayingBar() }       // аксессуар над/рядом с таб-баром

NavigationStack {
    List { … }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Поделиться", systemImage: "square.and.arrow.up") { }
                Button("Ещё", systemImage: "ellipsis") { }
            }
            ToolbarSpacer(.fixed, placement: .topBarTrailing)     // разделить острова
            ToolbarItem(placement: .confirmationAction) { Button("Готово") { } }  // prominent
        }
}
```

- Иконки в тулбаре без рамок — стекло даст система. Текст и иконки не смешивай в одной группе.
- `.sharedBackgroundVisibility(.hidden)` у `ToolbarItem` — вынести элемент из общей стеклянной группы.
- `.scrollEdgeEffectStyle(.soft | .hard, for: .top)` — стиль scroll edge (hard — для закреплённых заголовков, чаще на macOS).
- `.backgroundExtensionEffect()` — у изображения, которое должно продолжаться под sidebar/inspector.
- Sheets: `.presentationDetents([.medium, .large])` — стекло на medium и непрозрачность на large система делает сама.

### 2.5. Концентричность

```swift
RoundedRectangle(cornerRadius: 24, style: .continuous)   // всегда .continuous
ConcentricRectangle()                                    // iOS 26+: радиус от контейнера
    .containerShape(.rect(cornerRadius: 32))             // задать форму контейнера
```

### 2.6. Движение

```swift
withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { selection = tab }   // snappy
.animation(.spring(duration: 0.5, bounce: 0.3), value: isShown)                    // bouncy
.matchedGeometryEffect(id: "card", in: ns)                   // морфинг не-стеклянных форм
.navigationTransition(.zoom(sourceID: id, in: ns))           // iOS 18+: переход из ячейки
.matchedTransitionSource(id: id, in: ns)
.sensoryFeedback(.selection, trigger: selection)
```

Пресеты `.smooth`, `.snappy`, `.bouncy` близки к токенам smooth/snappy/bouncy; для точного соответствия используй `response`/`dampingFraction` из [02-tokens.md](../docs/02-tokens.md#8-движение).

### 2.7. Backport для iOS 17–18 / macOS 14–15

```swift
extension View {
    @ViewBuilder
    func liquidGlass<S: Shape>(in shape: S, interactive: Bool = false) -> some View {
        if #available(iOS 26, macOS 26, tvOS 26, watchOS 26, visionOS 26, *) {
            glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
        } else {
            background(.ultraThinMaterial, in: shape)
                .overlay(
                    shape.stroke(
                        LinearGradient(colors: [.white.opacity(0.8), .white.opacity(0.12), .white.opacity(0.45)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing),
                        lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.16), radius: 15, y: 8)
        }
    }
}
```

## 3. UIKit

```swift
// Одиночный стеклянный элемент
let effect = UIGlassEffect()                // UIGlassEffect(style: .clear) — для медиа
effect.isInteractive = true                 // набухание и свечение при касании
effect.tintColor = nil                      // .systemBlue — только для главного действия
let glassView = UIVisualEffectView(effect: effect)
glassView.cornerConfiguration = .capsule()  // iOS 26: капсула / концентричные углы
glassView.contentView.addSubview(iconView)

// Группа со слиянием
let containerEffect = UIGlassContainerEffect()
containerEffect.spacing = 24
let container = UIVisualEffectView(effect: containerEffect)
container.contentView.addSubview(glassView)
container.contentView.addSubview(otherGlassView)

// Материализация: effect из nil внутри анимации
let appearing = UIVisualEffectView(effect: nil)
UIView.animate(springDuration: 0.5, bounce: 0.3) { appearing.effect = UIGlassEffect() }

// Кнопки
var config = UIButton.Configuration.glass()          // .prominentGlass(), .clearGlass(), .prominentClearGlass()
config.title = "Готово"
let button = UIButton(configuration: config)

// Бары
tabBarController.tabBarMinimizeBehavior = .onScrollDown
```

Остальное (навбар, тулбар, sheets с detents, меню `UIMenu`) получает стекло автоматически, если ты не задал им свои фоны.

## 4. AppKit (macOS)

```swift
let glass = NSGlassEffectView()
glass.contentView = hostingView           // твой контент
glass.cornerRadius = 18
glass.tintColor = nil                     // акцент — только для главного действия

let container = NSGlassEffectContainerView()
container.spacing = 24
container.contentView = stackOfGlassViews // слияние соседних NSGlassEffectView

button.bezelStyle = .glass
```

- `NSToolbar`, sidebar в `NSSplitViewController` (поведение `.sidebar`), инспекторы, меню и поповеры получают стекло автоматически.
- Контент под плавающим sidebar/тулбаром: `NSBackgroundExtensionView` (AppKit) / `.backgroundExtensionEffect()` (SwiftUI).
- Контролы macOS 26 выше и круглее: не фиксируй высоту кнопок старыми значениями, используй `controlSize`.

## 5. watchOS, tvOS, visionOS

Используй стандартные компоненты и те же модификаторы SwiftUI; на tvOS стекло реагирует на фокус (не на касание) — `.interactive()` там не нужен. visionOS исторически использует свой glass-материал окон; следуй его компонентам.

## 6. Кастомная линза над своим контентом (Metal)

Нативное стекло не отдаёт параметры рефракции. Если нужна *лупа* или особая линза над **своим** контентом (картой, фото, игрой) — `layerEffect` с Metal-шейдером (iOS 17+), портируя модель из [03-optics.md](../docs/03-optics.md):

```swift
image.layerEffect(
    ShaderLibrary.lens(.float2(lensCenter), .float2(lensSize), .float(radius), .float(bezel), .float(strength)),
    maxSampleOffset: CGSize(width: strength, height: strength))
```

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

float sdRoundRect(float2 p, float2 b, float r) {
    float2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

[[ stitchable ]] half4 lens(float2 pos, SwiftUI::Layer layer, float2 center, float2 size,
                            float radius, float bezel, float strength) {
    float2 p = pos - center;
    float2 b = size * 0.5;
    float d = sdRoundRect(p, b, radius);
    if (d > 0.0) return layer.sample(pos);
    float e = 0.5;
    float2 n = normalize(float2(sdRoundRect(p + float2(e, 0), b, radius) - sdRoundRect(p - float2(e, 0), b, radius),
                                sdRoundRect(p + float2(0, e), b, radius) - sdRoundRect(p - float2(0, e), b, radius)));
    float t = clamp(-d / bezel, 0.0, 1.0);
    float disp = pow(1.0 - t, 3.0) * strength;      // дешёвая аппроксимация профиля Снеллиуса
    return layer.sample(pos - n * disp);
}
```

Это не замена `glassEffect` для хрома приложения — только для спецэффектов в контенте.

## 7. Кроссплатформенные фреймворки на Apple

- **React Native / Expo:** на iOS 26 — нативное стекло через `expo-glass-effect` или `@callstack/liquid-glass`, см. [cross-platform.md](cross-platform.md).
- **Flutter:** см. [flutter.md](flutter.md) (там — и нативные вставки, и шейдерная имитация).
- **.NET MAUI:** handler с `UIGlassEffect` на iOS 26+, см. [cross-platform.md](cross-platform.md).
