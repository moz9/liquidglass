# Windows: WinUI 3, UWP, WPF, WinForms, Avalonia, Uno, Win32

> Сниппеты исходной реализации: перед переносом прочитай [актуальный маршрут](../docs/emulation.md) и [чек-лист](../docs/08-checklist.md). Сверяй API с целевым SDK; таблицы возможностей и числа ниже не доказывают работу на конкретном устройстве.

На Windows нет системного Liquid Glass. Система даёт **материалы окна** (Mica, Mica Alt, Acrylic) и **Composition-эффекты** — из них собирается T1 (живой blur + saturation + fill + rim + тень + свечение). Рефракция (T2) возможна только частично (см. §2.6). Не ломай платформу: системные кнопки окна, Snap Layouts, клавиатурная навигация, контекстные меню по правому клику.

## 0. Выбор по стеку

| Стек | T1 (матовое стекло) | T2 (линза) | Фон окна |
|---|---|---|---|
| **WinUI 3** (Windows App SDK) | Composition backdrop-эффект (§2.2) — рекомендуется; `AcrylicBrush` — грубое приближение | приближение «полосой линзы» (§2.6) или Win2D для известного фона | `MicaBackdrop` / `DesktopAcrylicBackdrop` |
| **UWP** | то же на `Windows.UI.Composition` | то же | `BackdropMaterial` / `AcrylicBrush(HostBackdrop)` |
| **WPF** | `VisualBrush` + `BlurEffect` (§3) | свой `ShaderEffect` HLSL (§3.3) | DWM `DWMWA_SYSTEMBACKDROP_TYPE` |
| **WinForms** | нет нормального пути — хостинг WinUI (XAML Islands) или WebView2 (§4) | — | DWM backdrop |
| **Avalonia** | Skia backdrop-фильтр в `ICustomDrawOperation` (§5) | SkSL-шейдер (порт AGSL) | `TransparencyLevelHint` |
| **Uno Platform** | на Windows — как WinUI; на Skia-таргетах — Skia-путь (§6) | SkSL | — |
| **Electron / Tauri / WebView2** | веб-эталон ([web.md](web.md)) | веб-эталон (Chromium) | `backgroundMaterial` / `window-vibrancy` |
| **Flutter Windows** | [flutter.md](flutter.md) | Impeller | `flutter_acrylic` |
| **Qt** | [cross-platform.md](cross-platform.md#qt-6--qml) | `ShaderEffect` | — |
| **Win32 / C++** | `Windows.UI.Composition` через DesktopWindowTarget (§7) | Win2D/свой D3D | DWM |

## 1. Общее: окно, настройки, уровни

**Окно.** Фон окна — контент или системный материал; Liquid Glass — только плавающие элементы поверх.

```xml
<!-- WinUI 3: MainWindow.xaml -->
<Window.SystemBackdrop>
    <MicaBackdrop Kind="Base" />       <!-- или <DesktopAcrylicBackdrop /> для утилитарных окон -->
</Window.SystemBackdrop>
```

```csharp
ExtendsContentIntoTitleBar = true;   // контент уходит под заголовок, тулбар — стеклянные острова
SetTitleBar(AppTitleBarDragRegion);
```

**Настройки пользователя → уровень** (события приходят не в UI-потоке):

```csharp
using Windows.UI.ViewManagement;
using Windows.System.Power;

public static class GlassTier
{
    static readonly UISettings Ui = new();
    public static event Action? Changed;

    /// true, если в приложении реализована рефракция (§2.6)
    public static bool LensImplemented { get; set; }

    public static int Current
    {
        get
        {
            if (!Ui.AdvancedEffectsEnabled || new AccessibilitySettings().HighContrast) return 0;   // T0
            bool saver = PowerManager.EnergySaverStatus == EnergySaverStatus.On;
            return saver || !LensImplemented ? 1 : 2;
        }
    }

    public static bool ReduceMotion => !Ui.AnimationsEnabled;

    static GlassTier()
    {
        Ui.AdvancedEffectsEnabledChanged += (_, _) => Changed?.Invoke();
        PowerManager.EnergySaverStatusChanged += (_, _) => Changed?.Invoke();
    }
}
// подписчик: GlassTier.Changed += () => DispatcherQueue.TryEnqueue(ApplyTier);
```

Системные `MicaBackdrop`/`AcrylicBrush` сами становятся непрозрачными при выключенной прозрачности; **твои Composition-кисти — нет**, переключай их на solid сам.

## 2. WinUI 3

### 2.1. Быстрое приближение: `AcrylicBrush` (in-app)

```xml
<Border CornerRadius="22" Height="44" Padding="16,0">
    <Border.Background>
        <AcrylicBrush TintColor="#FFFFFF" TintOpacity="0.1" TintLuminosityOpacity="0.2" FallbackColor="#F9F9FB" />
    </Border.Background>
</Border>
```

Размытие Acrylic фиксированное и сильное (это Fluent, а не Liquid Glass), насыщенность не настраивается. Годится как fallback; для похожего вида используй §2.2.

### 2.2. Рекомендуемо: Composition backdrop-эффект

Граф T1: размытый фон → `ColorMatrixEffect` (насыщенность и яркость одной матрицей 5 × 4) → поверх `ColorSourceEffect` с полупрозрачной заливкой. Цвет заливки анимируемый — им же переключается вид (light/dark) и уровень T0.

```csharp
// NuGet: Microsoft.WindowsAppSDK, Microsoft.Graphics.Win2D
using System.Numerics;
using Microsoft.Graphics.Canvas;
using Microsoft.Graphics.Canvas.Effects;
using Microsoft.UI;
using Microsoft.UI.Composition;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Hosting;
using Windows.UI;

public sealed class GlassSurface : IDisposable
{
    readonly FrameworkElement _host;
    readonly SpriteVisual _sprite;
    readonly CompositionRoundedRectangleGeometry _clip;
    readonly CompositionEffectBrush _brush;

    /// fill — цвет заливки С альфой из токенов: light #33FFFFFF (20 %), dark #5C1E1E22 (36 %), T0 — альфа 0.97
    public GlassSurface(FrameworkElement host, float cornerRadius, Color fill,
                        float blur = 10f, float saturation = 1.8f, float brightness = 1.05f)
    {
        _host = host;
        var compositor = ElementCompositionPreview.GetElementVisual(host).Compositor;

        var graph = new CompositeEffect
        {
            Mode = CanvasComposite.SourceOver,
            Sources =
            {
                new ColorMatrixEffect
                {
                    ColorMatrix = SaturationBrightness(saturation, brightness),
                    Source = new GaussianBlurEffect
                    {
                        Name = "Blur",
                        BlurAmount = blur,                       // σ в DIP
                        BorderMode = EffectBorderMode.Hard,
                        Source = new CompositionEffectSourceParameter("Backdrop"),
                    },
                },
                new ColorSourceEffect { Name = "Fill", Color = fill },
            },
        };
        var factory = compositor.CreateEffectFactory(graph, new[] { "Blur.BlurAmount", "Fill.Color" });
        _brush = factory.CreateBrush();
        _brush.SetSourceParameter("Backdrop", compositor.CreateBackdropBrush());

        _clip = compositor.CreateRoundedRectangleGeometry();
        _clip.CornerRadius = new Vector2(cornerRadius);
        _sprite = compositor.CreateSpriteVisual();
        _sprite.Brush = _brush;
        _sprite.Clip = compositor.CreateGeometricClip(_clip);
        _sprite.RelativeSizeAdjustment = Vector2.One;   // заполняет host

        ElementCompositionPreview.SetElementChildVisual(host, _sprite);
        host.SizeChanged += OnSizeChanged;
    }

    void OnSizeChanged(object s, SizeChangedEventArgs e) =>
        _clip.Size = new Vector2((float)e.NewSize.Width, (float)e.NewSize.Height);

    /// Смена вида light/dark, переход в T0 (альфа 0.97) — без пересоздания графа.
    public void SetFill(Color fill) => _brush.Properties.InsertColor("Fill.Color", fill);

    /// col' = mix(luma, col, s) * k
    static Matrix5x4 SaturationBrightness(float s, float k)
    {
        const float r = 0.2126f, g = 0.7152f, b = 0.0722f;
        return new Matrix5x4
        {
            M11 = k * (r + (1 - r) * s), M12 = k * (r - r * s),       M13 = k * (r - r * s),       M14 = 0,
            M21 = k * (g - g * s),       M22 = k * (g + (1 - g) * s), M23 = k * (g - g * s),       M24 = 0,
            M31 = k * (b - b * s),       M32 = k * (b - b * s),       M33 = k * (b + (1 - b) * s), M34 = 0,
            M41 = 0, M42 = 0, M43 = 0, M44 = 1,
            M51 = 0, M52 = 0, M53 = 0, M54 = 0,
        };
    }

    public void Dispose()
    {
        _host.SizeChanged -= OnSizeChanged;
        ElementCompositionPreview.SetElementChildVisual(_host, null);
        _sprite.Dispose();
        _brush.Dispose();
    }
}
```

Яркость и насыщенность зашиты в матрицу; при смене темы (1.05 → 0.92) пересоздай `GlassSurface` — это редкое событие.

`CompositionBackdropBrush` видит содержимое **окна** под элементом. Фон за окном (рабочий стол) — только через `SystemBackdrop`.

### 2.3. Разметка компонента: слои, контур, тень

```xml
<!-- xmlns:ui="using:CommunityToolkit.WinUI" xmlns:media="using:CommunityToolkit.WinUI.Media" -->
<Grid x:Name="GlassRoot" Height="44" CornerRadius="22">
    <ui:Effects.Shadow>
        <!-- тень рисуется только СНАРУЖИ формы: не просвечивает сквозь стекло -->
        <media:AttachedCardShadow CornerRadius="22" BlurRadius="30" Offset="0,10" Opacity="0.18" Color="Black" />
    </ui:Effects.Shadow>

    <Border x:Name="BackdropHost" />                       <!-- сюда GlassSurface -->
    <Border x:Name="GlowHost" IsHitTestVisible="False" />  <!-- свечение касания, §2.4 -->

    <ContentPresenter Margin="16,0" VerticalAlignment="Center" />

    <Border IsHitTestVisible="False" CornerRadius="22" BorderThickness="1">
        <Border.BorderBrush>                                <!-- rim: свет сверху-слева -->
            <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
                <GradientStop Offset="0" Color="#E6FFFFFF" />
                <GradientStop Offset="0.34" Color="#24FFFFFF" />
                <GradientStop Offset="0.66" Color="#24FFFFFF" />
                <GradientStop Offset="1" Color="#80FFFFFF" />
            </LinearGradientBrush>
        </Border.BorderBrush>
    </Border>
</Grid>
```

Цвета контура/заливки/меток держи в `ThemeDictionaries` (`Light`, `Dark`, `HighContrast`) — значения из токенов. В `HighContrast` — системные `SystemColorWindowColor`/`SystemColorWindowTextColor`, без стекла.

### 2.4. Свечение, следующее за указателем

```csharp
var compositor = ElementCompositionPreview.GetElementVisual(GlowHost).Compositor;
var glow = compositor.CreateRadialGradientBrush();
glow.EllipseRadius = new Vector2(90);
glow.MappingMode = CompositionMappingMode.Absolute;
glow.ColorStops.Add(compositor.CreateColorGradientStop(0f, Color.FromArgb(140, 255, 255, 255)));
glow.ColorStops.Add(compositor.CreateColorGradientStop(0.7f, Color.FromArgb(0, 255, 255, 255)));

var glowSprite = compositor.CreateSpriteVisual();
glowSprite.Brush = glow;
glowSprite.RelativeSizeAdjustment = Vector2.One;
glowSprite.Opacity = 0;
glowSprite.Clip = compositor.CreateGeometricClip(clipGeometry);   // та же скруглённая геометрия
ElementCompositionPreview.SetElementChildVisual(GlowHost, glowSprite);

var pointer = ElementCompositionPreview.GetPointerPositionPropertySet(GlassRoot);
var follow = compositor.CreateExpressionAnimation("Vector2(p.Position.X, p.Position.Y)");
follow.SetReferenceParameter("p", pointer);
glow.StartAnimation(nameof(glow.EllipseCenter), follow);

// нажатие: opacity 0 → 1 за 80 мс, отпускание: → 0 за 450 мс
```

### 2.5. Пружины: набухание, «желе», капля-индикатор

```csharp
// Набухание при нажатии (токен press: response 0.22, ζ 0.65)
void Press(UIElement el, bool down)
{
    var c = ElementCompositionPreview.GetElementVisual(el).Compositor;
    var spring = c.CreateSpringVector3Animation();
    spring.Target = "Scale";
    float s = down ? MathF.Min(1 + 8f / (float)Math.Max(el.ActualSize.X, el.ActualSize.Y), 1.12f) : 1f;
    spring.FinalValue = new Vector3(s, s, 1);
    spring.DampingRatio = down ? 0.65f : 0.55f;                                  // press / release
    spring.Period = TimeSpan.FromMilliseconds(down ? 220 : 380);
    el.CenterPoint = new Vector3(el.ActualSize.X / 2, el.ActualSize.Y / 2, 0);
    el.StartAnimation(spring);
}
```

Для перетаскиваний с «броском» передавай скорость жеста в `InitialVelocity`. `ScaleTransform` в `RenderTransform` для этого не используй — пружины Composition работают с `UIElement.Scale/Translation/Rotation` без UI-потока.

**Капля-индикатор** — скруглённая геометрия, у которой левый и правый край ведут две пружины (корни капсулы не искажаются, в отличие от `Scale.X`):

```csharp
var props = compositor.CreatePropertySet();
props.InsertScalar("Left", 0f);
props.InsertScalar("Right", 0f);

var geometry = compositor.CreateRoundedRectangleGeometry();
geometry.CornerRadius = new Vector2(27);
var shape = compositor.CreateSpriteShape(geometry);
shape.FillBrush = compositor.CreateColorBrush(Color.FromArgb(46, 120, 120, 128));   // indicator
var visual = compositor.CreateShapeVisual();
visual.Shapes.Add(shape);
visual.RelativeSizeAdjustment = Vector2.One;
ElementCompositionPreview.SetElementChildVisual(IndicatorHost, visual);

var x = compositor.CreateExpressionAnimation("p.Left");               x.SetReferenceParameter("p", props);
var w = compositor.CreateExpressionAnimation("Vector2(p.Right - p.Left, h)");
w.SetReferenceParameter("p", props); w.SetScalarParameter("h", 54f);
geometry.StartAnimation("Offset.X", x);
geometry.StartAnimation("Size", w);

void Select(float left, float right, bool movingRight)
{
    var lead = compositor.CreateSpringScalarAnimation();  lead.DampingRatio = 0.80f;  lead.Period = TimeSpan.FromMilliseconds(240);
    var trail = compositor.CreateSpringScalarAnimation(); trail.DampingRatio = 0.74f; trail.Period = TimeSpan.FromMilliseconds(420);
    (movingRight ? lead : trail).FinalValue = right;
    (movingRight ? trail : lead).FinalValue = left;
    props.StartAnimation("Right", movingRight ? lead : trail);
    props.StartAnimation("Left", movingRight ? trail : lead);
}
```

**Морфинг кнопка → меню:** ручной FLIP на `Visual`: панель в финальном layout, `Offset`/`Scale` стартуют из прямоугольника кнопки, пружина `morph` (ζ 0.78, Period 420 мс) к единице; радиус клипа (`CompositionRoundedRectangleGeometry.CornerRadius`) анимируется из `h/2` в радиус меню, содержимое — fade на последних 45 %. Для переходов между страницами — `ConnectedAnimationService`.

Reduce Motion (`GlassTier.ReduceMotion`): `DampingRatio = 1`, `Period ≤ 250 мс`, без растяжений.

### 2.6. Рефракция на WinUI (T2, приближённо)

Composition-граф не поддерживает `DisplacementMapEffect` и пиксельные шейдеры над backdrop. Варианты:

1. **«Полоса линзы» (экспериментально).** Второй backdrop-спрайт того же размера: `Transform2DEffect` масштабирует фон к центру на 3–5 % (`Matrix3x2.CreateScale(1.04f, center)`), результат ограничивается маской-кольцом по контуру (`CompositionMaskBrush` с `CompositionNineGridBrush` из PNG кольца с мягким градиентом — nine-grid сохраняет круглые углы при любом размере). Даёт сдвиг фона у кромки, похожий на линзирование. Проверяй на целевой версии Windows App SDK: поддержка комбинаций mask/nine-grid/backdrop в графах различается.
2. **Известный фон** (своя картинка, обои, сцена): рисуй стекло в `CanvasControl`/`CanvasAnimatedControl` (Win2D) — `DisplacementMapEffect` с картой из [03-optics.md](../docs/03-optics.md#31-карта-смещений-для-svg-fedisplacementmap-win2d-skia-qt) + `GaussianBlurEffect`. Здесь рефракция точная.
3. **Чужой рендер:** WebView2 с веб-эталоном (Chromium, T2) для отдельных экранов.

Если ни один не подходит — честно оставайся на T1: блик, тень, свечение и правильное движение дают 80 % впечатления.

## 3. WPF

### 3.1. Окно: Mica / Acrylic через DWM (Windows 11 22H2+)

```csharp
using System.Runtime.InteropServices;
using System.Windows.Interop;

static class Dwm
{
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    [DllImport("dwmapi.dll")] static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref Margins m);
    [StructLayout(LayoutKind.Sequential)] struct Margins { public int L, R, T, B; }

    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20, DWMWA_SYSTEMBACKDROP_TYPE = 38;
    public enum Backdrop { Auto = 0, None = 1, Mica = 2, Acrylic = 3, MicaAlt = 4 }

    public static void Apply(Window w, Backdrop kind, bool dark)
    {
        var hwnd = new WindowInteropHelper(w).EnsureHandle();
        HwndSource.FromHwnd(hwnd).CompositionTarget.BackgroundColor = Colors.Transparent;
        w.Background = Brushes.Transparent;
        var m = new Margins { L = -1, R = -1, T = -1, B = -1 };
        DwmExtendFrameIntoClientArea(hwnd, ref m);
        int d = dark ? 1 : 0, k = (int)kind;
        DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref d, sizeof(int));
        DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, ref k, sizeof(int));
    }
}
```

Вызывай в `SourceInitialized`. Альтернатива — библиотека WPF-UI (`FluentWindow`, `WindowBackdropType`). В .NET 9+ есть Fluent-тема (`Application.ThemeMode`, экспериментально).

### 3.2. Стекло внутри окна: `VisualBrush` + `BlurEffect`

В WPF нет backdrop-кисти. Стекло рисует *копию* фона под собой:

```xml
<Grid>
    <Grid x:Name="Scene"> <!-- контент, который окажется под стеклом --> </Grid>

    <Grid x:Name="Glass" Width="320" Height="62" VerticalAlignment="Bottom" Margin="0,0,0,12">
        <Grid.Effect>                         <!-- внешний эффект: рефракция (§3.3), обрабатывает уже размытое -->
            <local:LiquidGlassEffect x:Name="Lens" />
        </Grid.Effect>
        <Rectangle x:Name="Backdrop" Margin="-30">   <!-- с запасом 3σ, чтобы края не темнели -->
            <Rectangle.Fill>
                <VisualBrush x:Name="BackdropBrush" Visual="{Binding ElementName=Scene}"
                             ViewboxUnits="Absolute" Stretch="None" AlignmentX="Left" AlignmentY="Top" />
            </Rectangle.Fill>
            <Rectangle.Effect><BlurEffect Radius="25" KernelType="Gaussian" RenderingBias="Performance" /></Rectangle.Effect>
        </Rectangle>
        <Border Background="#33FFFFFF" />             <!-- fill -->
        <ContentPresenter />
    </Grid>
</Grid>
```

```csharp
// Viewbox = прямоугольник стекла (+ запас) в координатах Scene; обновлять при ресайзе/перемещении.
void SyncBackdrop()
{
    var topLeft = Glass.TranslatePoint(new Point(-30, -30), Scene);
    BackdropBrush.Viewbox = new Rect(topLeft, new Size(Glass.ActualWidth + 60, Glass.ActualHeight + 60));
    Glass.Clip = new RectangleGeometry(new Rect(0, 0, Glass.ActualWidth, Glass.ActualHeight),
                                       Glass.ActualHeight / 2, Glass.ActualHeight / 2);   // капсула
}
```

Тень и контур — отдельные элементы *под* и *над* `Glass` (`DropShadowEffect` на отдельном `Border` той же формы под стеклом, контур — `Border` с `LinearGradientBrush` поверх). Насыщенность: второй `ShaderEffect` или часть шейдера §3.3.

Производительность: `VisualBrush` перерисовывает источник; для динамичного контента ограничь площадь, поставь `CacheMode="BitmapCache"` на медленно меняющиеся части `Scene`, проверь `RenderCapability.Tier >> 16 == 2` (иначе эффекты считаются на CPU → T0).

### 3.3. Рефракция: `ShaderEffect` (HLSL ps_3_0)

Шейдер: [`reference/shaders/LiquidGlass.wpf.hlsl`](../reference/shaders/LiquidGlass.wpf.hlsl). Компиляция: `fxc /T ps_3_0 /E main /Fo LiquidGlass.ps LiquidGlass.wpf.hlsl` (Windows SDK), `.ps` — ресурс сборки.

```csharp
public sealed class LiquidGlassEffect : ShaderEffect
{
    static readonly PixelShader Shader = new() { UriSource = new Uri("pack://application:,,,/Shaders/LiquidGlass.ps") };

    public static readonly DependencyProperty InputProperty =
        RegisterPixelShaderSamplerProperty(nameof(Input), typeof(LiquidGlassEffect), 0);
    public static readonly DependencyProperty SizeProperty = DependencyProperty.Register(nameof(Size), typeof(Point),
        typeof(LiquidGlassEffect), new UIPropertyMetadata(new Point(320, 62), PixelShaderConstantCallback(0)));
    /// X = corner radius, Y = bezel, Z = strength, W = IOR
    public static readonly DependencyProperty ShapeProperty = DependencyProperty.Register(nameof(Shape), typeof(Point4D),
        typeof(LiquidGlassEffect), new UIPropertyMetadata(new Point4D(31, 21, 21, 1.5), PixelShaderConstantCallback(1)));
    /// X, Y = direction toward the light, Z = rim intensity, W = profile exponent
    public static readonly DependencyProperty LightProperty = DependencyProperty.Register(nameof(Light), typeof(Point4D),
        typeof(LiquidGlassEffect), new UIPropertyMetadata(new Point4D(-0.6, -0.8, 0.9, 3), PixelShaderConstantCallback(2)));
    /// X = saturation, Y = brightness
    public static readonly DependencyProperty MaterialProperty = DependencyProperty.Register(nameof(Material), typeof(Point),
        typeof(LiquidGlassEffect), new UIPropertyMetadata(new Point(1.8, 1.05), PixelShaderConstantCallback(3)));

    public LiquidGlassEffect()
    {
        PixelShader = Shader;
        UpdateShaderValue(InputProperty); UpdateShaderValue(SizeProperty); UpdateShaderValue(ShapeProperty);
        UpdateShaderValue(LightProperty); UpdateShaderValue(MaterialProperty);
    }
    public Brush Input { get => (Brush)GetValue(InputProperty); set => SetValue(InputProperty, value); }
    public Point Size { get => (Point)GetValue(SizeProperty); set => SetValue(SizeProperty, value); }
    public Point4D Shape { get => (Point4D)GetValue(ShapeProperty); set => SetValue(ShapeProperty, value); }
    public Point4D Light { get => (Point4D)GetValue(LightProperty); set => SetValue(LightProperty, value); }
    public Point Material { get => (Point)GetValue(MaterialProperty); set => SetValue(MaterialProperty, value); }
}
```

`Size` обновляй в `SizeChanged` (в пикселях с учётом DPI: `VisualTreeHelper.GetDpi(this).DpiScaleX`).

### 3.4. Движение в WPF

Пружин из коробки нет. Используй `CompositionTarget.Rendering` + интегратор пружины (порт класса `Spring` из `liquid-glass.js`: полу-неявный Эйлер с шагом 1/240 с) и анимируй `RenderTransform` (`ScaleTransform`, `TranslateTransform`) — это не вызывает layout. `Storyboard` с `ElasticEase`/`BackEase` допустим только для простых переходов и не прерывается с сохранением скорости.

## 4. WinForms

Честно: нормального стекла внутри WinForms-формы нет (GDI+ не имеет композитора и backdrop). Варианты:
- фон окна — DWM backdrop (тот же `Dwm.Apply`, что для WPF, с `this.Handle`), элементы поверх — непрозрачные с тенью и контуром (T0-стиль);
- стеклянные панели — через хостинг WinUI (`DesktopWindowXamlSource`, Windows App SDK 1.4+) или WebView2 с веб-эталоном;
- при статичном фоне — один раз размытая копия фона (`Bitmap`) под панелью: дёшево, но фон не живой.

Для интерфейса, где стекло — ключевая часть, рекомендуй пользователю миграцию экрана на WinUI 3 / WPF / WebView2.

## 5. Avalonia (11+)

**Окно:**
```xml
<Window TransparencyLevelHint="Mica, AcrylicBlur, Blur" Background="Transparent"
        ExtendClientAreaToDecorationsHint="True">
```
`ExperimentalAcrylicBorder` размывает то, что **за окном**, а не контент приложения — для фона окна.

**Стекло над контентом:** свой контрол с Skia backdrop-фильтром:

```csharp
public sealed class GlassPanel : Decorator
{
    public static readonly StyledProperty<double> RadiusProperty = AvaloniaProperty.Register<GlassPanel, double>(nameof(Radius), 22);
    public double Radius { get => GetValue(RadiusProperty); set => SetValue(RadiusProperty, value); }

    public override void Render(DrawingContext context)
    {
        context.Custom(new GlassDrawOp(new Rect(Bounds.Size), (float)Radius));
        base.Render(context);
    }

    sealed class GlassDrawOp(Rect bounds, float radius) : ICustomDrawOperation
    {
        public Rect Bounds => bounds;
        public bool HitTest(Point p) => false;
        public bool Equals(ICustomDrawOperation? other) => false;
        public void Dispose() { }

        public void Render(ImmediateDrawingContext context)
        {
            var lease = context.TryGetFeature<ISkiaSharpApiLeaseFeature>();
            if (lease is null) return;                                   // не Skia-бэкенд → T0
            using var api = lease.Lease();
            var canvas = api.SkCanvas;
            var rect = new SKRect(0, 0, (float)bounds.Width, (float)bounds.Height);
            using var shape = new SKRoundRect(rect, radius);

            canvas.Save();
            canvas.ClipRoundRect(shape, antialias: true);
            using var blur = SKImageFilter.CreateBlur(10, 10);            // σ из токенов
            using var sat = SKColorFilter.CreateColorMatrix(Saturation(1.8f));
            using var backdrop = SKImageFilter.CreateColorFilter(sat, blur);
            canvas.SaveLayer(new SKCanvasSaveLayerRec { Bounds = rect, Backdrop = backdrop });
            canvas.DrawColor(new SKColor(255, 255, 255, 51));              // fill 20 %
            canvas.Restore();
            canvas.Restore();
        }

        static float[] Saturation(float s)
        {
            const float r = 0.2126f, g = 0.7152f, b = 0.0722f;
            return new[]
            {
                r + (1 - r) * s, g - g * s,       b - b * s,       0, 0,
                r - r * s,       g + (1 - g) * s, b - b * s,       0, 0,
                r - r * s,       g - g * s,       b + (1 - b) * s, 0, 0,
                0, 0, 0, 1, 0,
            };
        }
    }
}
```

- `SKCanvasSaveLayerRec.Backdrop` есть в SkiaSharp 3.x; на старых версиях — T1-замена: `ExperimentalAcrylicBorder`/полупрозрачная заливка. Проверь версию SkiaSharp, которую тянет твой Avalonia.
- Backdrop видит то, что уже нарисовано в текущий слой; контролы с `Opacity < 1` или эффектами у предков рисуются в промежуточный слой — стекло внутри них «пустое» (аналог Backdrop Root в вебе).
- Рефракция: SkSL-шейдер — [`reference/shaders/liquid-glass.agsl`](../reference/shaders/liquid-glass.agsl) (AGSL = SkSL), через `SKRuntimeEffect` как image-filter, если твоя версия SkiaSharp его экспонирует.
- Движение: `Animation` с `SpringEasing` (параметры Mass / Stiffness / Damping — бери stiffness и damping из `tools/spring.mjs`) или свой интегратор на `TopLevel.RequestAnimationFrame`; анимируй `RenderTransform`.

## 6. Uno Platform

На Windows-таргете (WinAppSDK) — всё из §2. На Skia-таргетах (Desktop, WebAssembly, Android/iOS в Skia-режиме) Composition-эффекты поддержаны частично: проверь `CompositionEffectBrush`/`AcrylicBrush` в документации своей версии; иначе — Skia-путь как в Avalonia (`SKCanvasElement`).

## 7. Win32 / C++ (без XAML)

`Windows.UI.Composition` + `ICompositorDesktopInterop::CreateDesktopWindowTarget(hwnd, …)`: тот же граф, что в §2.2 (эффекты Win2D доступны и из C++/WinRT). `compositor.CreateHostBackdropBrush()` — размытие того, что **за окном**; `CreateBackdropBrush()` — визуальных элементов композиции под стеклом. Содержимое, нарисованное GDI/Direct2D в swap chain, должно быть визуалом композиции (`CompositionDrawingSurface`/swap chain visual), чтобы попасть в backdrop.

## 8. Шрифты и иконки на Windows

Segoe UI Variable (системный) или Inter; иконки — Segoe Fluent Icons допустимы, но ближе к Apple — Lucide/Phosphor (stroke 1.75–2, rounded). SF Pro и SF Symbols на Windows не встраивать.
