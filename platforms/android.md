# Android: Jetpack Compose, Views, Compose Multiplatform

На Android Liquid Glass — стилизация поверх платформы. Возможности по уровню API:

| API | Что есть | Уровень |
|---|---|---|
| 33+ (Android 13) | `RenderEffect` (blur, color filter, chain) + `RuntimeShader` (AGSL) | **T2**: blur + рефракция |
| 31–32 (Android 12) | `RenderEffect` без шейдеров | **T1** |
| < 31 | нет GPU-размытия в UI-тулките | **T1-lite**: полупрозрачная заливка без живого blur (или библиотека с RenderScript-fallback), rim, тень |

Поведение платформы не ломай: системный жест «назад», `enableEdgeToEdge()` + инсеты, 48 dp зоны касания, TalkBack.

## 0. Выбор пути

| Задача | Путь |
|---|---|
| Compose, нужен T1 быстро, есть KMP | библиотека **Haze** (§2) |
| Compose, нужна рефракция и полный контроль | **своя реализация** на `GraphicsLayer` + AGSL (§1) — эталон ниже |
| Compose, готовая Liquid Glass-библиотека | `io.github.kyant0:backdrop` (Kyant0/AndroidLiquidGlass: lens, blur, vibrancy на AGSL) — проверь актуальный API в README |
| Views (XML) | **BlurView** (Dimezis) + свои rim/тень, `SpringAnimation` (§3) |
| Flutter / React Native / MAUI | [flutter.md](flutter.md), [cross-platform.md](cross-platform.md) |

## 1. Compose: своя реализация (T0–T2)

Идея: контент экрана записывается в `GraphicsLayer` (источник). Стеклянный элемент рисует **этот же слой** со смещением к своей позиции в собственный `GraphicsLayer` с `RenderEffect` (blur → saturation → рефракция), обрезает формой, сверху — заливка и rim. Требуется Compose UI 1.7+.

```kotlin
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.unit.dp
import kotlin.math.min

/** Источник фона для стекла: обычно весь контент экрана под барами. */
@Stable
class GlassBackdrop internal constructor(internal val layer: GraphicsLayer) {
    internal var offsetInRoot by mutableStateOf(Offset.Zero)
}

@Composable
fun rememberGlassBackdrop(): GlassBackdrop {
    val layer = rememberGraphicsLayer()
    return remember(layer) { GlassBackdrop(layer) }
}

fun Modifier.glassSource(backdrop: GlassBackdrop): Modifier = this
    .onGloballyPositioned { backdrop.offsetInRoot = it.positionInRoot() }
    .drawWithContent {
        backdrop.layer.record { this@drawWithContent.drawContent() }
        drawLayer(backdrop.layer)
    }

@Immutable
data class GlassStyle(
    val tier: Int,                  // 0 solid, 1 frosted, 2 lens
    val blur: Float = 10f,          // σ, dp
    val saturation: Float = 1.8f,
    val fill: Color,                // light: White 20 %, dark: Color(0xFF1E1E22) 36 %, solid: 97 %
    val rimLit: Color,              // light: White 90 %, dark: White 50 %
    val rimSide: Color,             // light: White 14 %, dark: White 6 %
    val rimOpposite: Color,         // light: White 50 %, dark: White 24 %
) {
    companion object {
        fun regular(dark: Boolean, tier: Int) = GlassStyle(
            tier = tier,
            fill = if (dark) Color(0xFF1E1E22).copy(alpha = 0.36f) else Color.White.copy(alpha = 0.20f),
            rimLit = Color.White.copy(alpha = if (dark) 0.50f else 0.90f),
            rimSide = Color.White.copy(alpha = if (dark) 0.06f else 0.14f),
            rimOpposite = Color.White.copy(alpha = if (dark) 0.24f else 0.50f),
        )
        fun solid(dark: Boolean) = regular(dark, tier = 0).copy(
            fill = if (dark) Color(0xFF1C1C1E).copy(alpha = 0.97f) else Color(0xFFF9F9FB).copy(alpha = 0.97f),
        )
    }
}

@Composable
fun Modifier.liquidGlass(
    backdrop: GlassBackdrop,
    style: GlassStyle,
    shape: Shape = RoundedCornerShape(percent = 50),
): Modifier {
    val glassLayer = rememberGraphicsLayer()
    var offsetInRoot by remember { mutableStateOf(Offset.Zero) }
    val shader = remember {
        if (Build.VERSION.SDK_INT >= 33) RuntimeShader(LIQUID_GLASS_AGSL) else null
    }
    return this
        .onGloballyPositioned { offsetInRoot = it.positionInRoot() }
        .drawWithCache {
            val outline = shape.createOutline(size, layoutDirection, this)
            val path = Path().apply { addOutline(outline) }
            val radius = (outline as? Outline.Rounded)?.roundRect?.topLeftCornerRadius?.x ?: 0f
            val live = style.tier >= 1 && Build.VERSION.SDK_INT >= 31
            if (live) glassLayer.renderEffect = glassEffect(size, radius, style, density, shader)
            val rim = Brush.linearGradient(
                0f to style.rimLit, 0.34f to style.rimSide, 0.66f to style.rimSide, 1f to style.rimOpposite,
                start = Offset.Zero, end = Offset(size.width, size.height),
            )
            onDrawBehind {
                if (live) {
                    glassLayer.record {
                        val src = backdrop.offsetInRoot
                        translate(src.x - offsetInRoot.x, src.y - offsetInRoot.y) { drawLayer(backdrop.layer) }
                    }
                    clipPath(path) { drawLayer(glassLayer) }
                }
                drawPath(path, style.fill)
                drawPath(path, rim, style = Stroke(width = 1.dp.toPx()))
            }
        }
}

@RequiresApi(31)
private fun glassEffect(size: Size, radius: Float, style: GlassStyle, density: Float, shader: RuntimeShader?): RenderEffect {
    val sigma = style.blur * density
    val blur = android.graphics.RenderEffect.createBlurEffect(sigma, sigma, Shader.TileMode.CLAMP)
    val saturate = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(style.saturation) })
    val frosted = android.graphics.RenderEffect.createColorFilterEffect(saturate, blur)
    if (style.tier < 2 || shader == null || Build.VERSION.SDK_INT < 33) return frosted.asComposeRenderEffect()

    val minSide = min(size.width, size.height)
    val bezel = (minSide * 0.35f).coerceIn(8f * density, 24f * density).coerceAtMost(minSide / 2f)
    shader.setFloatUniform("size", size.width, size.height)
    shader.setFloatUniform("radius", radius)
    shader.setFloatUniform("bezel", bezel)
    shader.setFloatUniform("strength", bezel)
    shader.setFloatUniform("ior", 1.5f)
    shader.setFloatUniform("profile", 3f)
    shader.setFloatUniform("aberration", 0f)
    val lens = android.graphics.RenderEffect.createRuntimeShaderEffect(shader, "content")
    return android.graphics.RenderEffect.createChainEffect(lens, frosted).asComposeRenderEffect()
}

// Содержимое reference/shaders/liquid-glass.agsl (положи в res/raw и читай, или вставь строкой).
const val LIQUID_GLASS_AGSL = """ ... """
```

Использование:

```kotlin
@Composable
fun Screen() {
    val backdrop = rememberGlassBackdrop()
    val dark = isSystemInDarkTheme()
    val tier = rememberGlassTier()                             // §5
    val style = if (tier == 0) GlassStyle.solid(dark) else GlassStyle.regular(dark, tier)

    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize().glassSource(backdrop)) { /* контент edge-to-edge */ }

        TabBar(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 12.dp)
                .shadow(16.dp, RoundedCornerShape(50), clip = false,
                        ambientColor = Color.Black.copy(alpha = 0.18f), spotColor = Color.Black.copy(alpha = 0.18f))
                .liquidGlass(backdrop, style),
        )
    }
}
```

Важно:
- Стекло не должно быть **внутри** `glassSource` (иначе оно рисует само себя). Источник и стекло — соседи в `Box`.
- Тень `Modifier.shadow` ставь **до** `liquidGlass`: стекло перекрывает её непрозрачной копией фона, снаружи тень видна.
- Если фон под стеклом меняется, а стекло не перерисовывается (редкие случаи со вложенными слоями), читай в `onDrawBehind` состояние, которое меняется вместе с контентом (например, offset скролла).
- `SurfaceView` (видео, камера, некоторые карты) не попадает в `GraphicsLayer` — стекло над ним будет пустым. Используй `TextureView`-режим плееров/карт или clear-вариант с затемнением без blur.

### 1.1. Нажатие: набухание, свечение, «желе»

```kotlin
@Composable
fun Modifier.glassPress(interaction: MutableInteractionSource, maxSide: Dp): Modifier {
    val pressed by interaction.collectIsPressedAsState()
    val scale = remember { Animatable(1f) }
    val reduceMotion = rememberReduceMotion()                  // §5
    val target = if (pressed && !reduceMotion) min(1f + 8f / maxSide.value, 1.12f) else 1f
    LaunchedEffect(target) {
        // Animatable продолжает с текущей скоростью — отсюда упругое колебание при отпускании
        scale.animateTo(target, if (pressed) spring(dampingRatio = 0.65f, stiffness = 815.7f)   // press
                                else spring(dampingRatio = 0.55f, stiffness = 273.4f))          // release
    }
    return graphicsLayer { scaleX = scale.value; scaleY = scale.value }
}
```

Кнопке: `Modifier.glassPress(src, 44.dp).clickable(src, indication = null) { … }` — стандартный ripple отключаем (`indication = null` или `LocalRippleConfiguration provides null` в Material 3), вместо него — свечение: храни точку касания из `pointerInput { awaitEachGesture { … } }` и рисуй в `drawWithContent` радиальный градиент `Brush.radialGradient(listOf(White.copy(.55f), Transparent), center = touch, radius = 90.dp.toPx())`, обрезанный формой, альфа — `Animatable` (80 мс вверх, 450 мс вниз).

### 1.2. Капля-индикатор

Индикатор рисуется в фазе draw (без layout), два края — две пружины:

```kotlin
val left = remember { Animatable(0f) }
val right = remember { Animatable(0f) }
LaunchedEffect(selected, itemBounds) {
    val target = itemBounds[selected]                                  // Rect в координатах бара
    val movingRight = target.left > left.value
    val lead = spring<Float>(dampingRatio = 0.80f, stiffness = 685.4f) // response 0.24
    val trail = spring<Float>(dampingRatio = 0.74f, stiffness = 223.8f) // response 0.42
    launch { left.animateTo(target.left, if (movingRight) trail else lead) }
    launch { right.animateTo(target.right, if (movingRight) lead else trail) }
}
Modifier.drawBehind {
    val h = size.height - 8.dp.toPx()
    drawRoundRect(indicatorColor, topLeft = Offset(left.value, 4.dp.toPx()),
                  size = Size(right.value - left.value, h), cornerRadius = CornerRadius(h / 2))
}
```

Перетаскивание (линза): `pointerInput` + `detectHorizontalDragGestures` → `left/right.snapTo` через пружину `interactive` (`spring(0.86f, 1754.6f)`), масштаб ×1.10, при отпускании — `animateTo` ближайшего элемента с `initialVelocity` из `VelocityTracker`.

### 1.3. Морфинг

```kotlin
SharedTransitionLayout {
    AnimatedContent(expanded, label = "menu") { open ->
        val bounds = Modifier.sharedBounds(
            rememberSharedContentState("menu"), this@AnimatedContent,
            boundsTransform = { _, _ -> spring(dampingRatio = 0.78f, stiffness = 223.8f) },   // morph
        )
        if (open) Menu(bounds.liquidGlass(backdrop, thickStyle, RoundedCornerShape(24.dp)))
        else MoreButton(bounds.liquidGlass(backdrop, style, CircleShape))
    }
}
```

## 2. Compose: Haze (T1, в т. ч. Compose Multiplatform)

```kotlin
// implementation("dev.chrisbanes.haze:haze:<latest>")
val hazeState = rememberHazeState()          // в старых версиях: remember { HazeState() }

Box {
    LazyColumn(Modifier.fillMaxSize().hazeSource(state = hazeState)) { … }
    TabBar(
        Modifier.align(Alignment.BottomCenter)
            .clip(RoundedCornerShape(50))
            .hazeEffect(state = hazeState, style = HazeStyle(
                backgroundColor = MaterialTheme.colorScheme.surface,
                tints = listOf(HazeTint(Color.White.copy(alpha = 0.20f))),
                blurRadius = 10.dp,
                noiseFactor = 0f,                    // у Liquid Glass нет шума (это черта Acrylic)
            ))
            .border(1.dp, rimBrush, RoundedCornerShape(50)),
    )
}
```

Haze сам делает fallback на старых API и даунсэмплинг. Рефракции нет — это T1. Сигнатуры `HazeStyle` менялись между версиями — сверяйся с README установленной версии.

## 3. Views (XML)

- **Размытие фона:** библиотека BlurView (Dimezis, `com.github.Dimezis:BlurView`): `blurView.setupWith(root…).setBlurRadius(10f).setOverlayColor(0x33FFFFFF)` (точный вызов `setupWith` зависит от версии библиотеки), `clipToOutline = true` + `outlineProvider` со скруглением.
- **Rim:** `GradientDrawable` со `setStroke` не умеет градиент — рисуй обводку в `onDrawForeground` через `Paint` с `LinearGradient` (135°) и `canvas.drawRoundRect`.
- **Тень:** `elevation` + `outlineAmbientShadowColor`/`outlineSpotShadowColor` (API 28+).
- **Рефракция (API 33+):** `view.setRenderEffect(RenderEffect.createChainEffect(runtimeShaderEffect, blur…))` — но `setRenderEffect` действует на **собственный** контент вью, поэтому применяй его к вью, которая рисует копию фона (как BlurView), а не к кнопке.
- **Пружины:**

```kotlin
fun View.pressSpring(down: Boolean) {
    val s = if (down) minOf(1f + 8f / maxOf(width, height) * resources.displayMetrics.density, 1.12f) else 1f
    for (prop in listOf(DynamicAnimation.SCALE_X, DynamicAnimation.SCALE_Y)) {
        SpringAnimation(this, prop).apply {
            spring = SpringForce(s).setDampingRatio(if (down) 0.65f else 0.55f).setStiffness(if (down) 815.7f else 273.4f)
            start()
        }
    }
}
```

Для прерываемости держи один экземпляр `SpringAnimation` на свойство и вызывай `animateToFinalPosition()` — скорость сохранится.

## 4. Compose Multiplatform

Haze поддерживает Android, iOS, Desktop (JVM) и Web (wasm). На iOS 26+ для максимальной близости к оригиналу встраивай нативное стекло: `UIKitView` с `UIVisualEffectView(effect: UIGlassEffect())` для баров. На Desktop (Skiko) AGSL-файл работает как SkSL через `RuntimeEffect`/`ImageFilter.makeRuntimeShader` — проверь API своей версии Skiko.

## 5. Уровень, доступность, производительность

```kotlin
@Composable
fun rememberGlassTier(userPrefersSolid: Boolean = false): Int {
    val context = LocalContext.current
    return remember(userPrefersSolid) {
        val am = context.getSystemService(ActivityManager::class.java)
        when {
            userPrefersSolid -> 0                                           // настройка «без прозрачности» в приложении
            Build.VERSION.SDK_INT < 31 -> 1                                 // T1-lite (без живого blur, см. таблицу)
            am.isLowRamDevice -> 1
            Build.VERSION.SDK_INT < 33 -> 1
            else -> 2
        }
    }
}

@Composable
fun rememberReduceMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}
```

- На API < 31 `GlassStyle.tier = 1` означает: `liquidGlass` не рисует живой фон (`live = false`), остаются заливка (подними альфу до ≈ 0.7), rim и тень.
- Системной настройки «уменьшить прозрачность» на Android нет — дай переключатель в настройках приложения; высокий контраст текста тоже не читается публичным API.
- Отслеживай просадки: `JankStats` (androidx.metrics) → при > 20 % janky frames за 2–3 с понижай tier до 1.
- Не больше 2–3 стеклянных поверхностей с живым фоном; рефракция — только таб-бар и ключевые кнопки.
- Анимации — через `graphicsLayer { }`/фазу draw; не анимируй размеры через layout, кроме одного элемента.

## 6. Шрифты и иконки

Inter или Roboto Flex; иконки — Material Symbols **Rounded** (weight 500–600) или Lucide/Phosphor. SF Pro / SF Symbols в APK не встраивать.
