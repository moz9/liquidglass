# 02. Токены

> Этот документ описывает исходные приближения и приёмы примеров. Приоритет имеют [AGENTS.md](../AGENTS.md), [Apple 26/27](apple-native.md), [ограничения реализации](emulation.md) и [актуальная приёмка](08-checklist.md). Числа и реакции не являются универсальными требованиями Apple; настройки плотности и доступности проверяются отдельно.

Источник истины — [`tokens/liquid-glass.tokens.json`](../tokens/liquid-glass.tokens.json) (формат W3C Design Tokens, читается Style Dictionary v4). Здесь — те же значения в удобных таблицах и правила перевода в единицы платформ.

> Значения — **откалиброванные приближения** для воспроизведения вне Apple. На iOS/macOS 26+ используй нативный материал и системные цвета, а не эти числа.

## 1. Единицы

| Платформа | Единица «1 px» из токенов | Примечание |
|---|---|---|
| Web | CSS `px` | |
| Apple | `pt` | |
| Android | `dp` (в `RenderEffect`/шейдерах — умножай на `density`) | |
| Windows (WinUI/WPF/UWP) | effective pixel (epx / DIP) | Composition-эффекты работают в DIP |
| Flutter | logical pixel | |
| Qt Quick | `px` × `Screen.devicePixelRatio` там, где API ждёт физические пиксели | |

**Размытие везде задано как σ (стандартное отклонение гауссианы):**

| API | Как передать σ |
|---|---|
| CSS `blur(r)` | `r = σ` (в CSS «радиус» и есть σ) |
| SwiftUI `.blur(radius:)` | `radius ≈ σ` |
| Android `RenderEffect.createBlurEffect(rx, ry, …)` | `rx = σ × density` (px), при необходимости подбери визуально |
| Flutter `ImageFilter.blur(sigmaX:)` | `sigmaX = σ` |
| Win2D / Composition `GaussianBlurEffect.BlurAmount` | `BlurAmount = σ` (DIP) |
| WPF `BlurEffect.Radius` | `Radius ≈ 2.5 × σ` (WPF задаёт радиус ядра, подбери визуально) |
| Qt `MultiEffect` | `blurMax = 2 × σ`, `blur = 0.5` (или подбери: 0–1 × blurMax) |
| Skia `SkImageFilters::Blur`, SkiaSharp `CreateBlur` | `sigma = σ` |

## 2. Материал

| Токен | Regular | Clear | Thick (меню, sheets) | Solid (T0) |
|---|---|---|---|---|
| blur σ | 10 | 2 | 24 | — |
| saturation | 1.8 | 1.5 | 1.8 | — |
| brightness light / dark | 1.05 / 0.92 | 1.08 / 0.96 | 1.0 | — |
| fill light | `rgb(255 255 255 / .20)` | `rgb(255 255 255 / .06)` | `rgb(248 248 250 / .72)` | `rgb(249 249 251 / .97)` |
| fill dark | `rgb(30 30 34 / .36)` | `rgb(0 0 0 / .08)` | `rgb(40 40 44 / .72)` | `rgb(28 28 30 / .97)` |

- **Tinted:** fill = accent 30 % поверх прозрачного, saturation 2.0.
- **Prominent:** fill = accent 86 %, текст `#FFFFFF`.
- **Clear + яркое медиа:** под стеклом (между медиа и стеклом) затемнение `rgb(0 0 0 / .22)` light / `.30` dark.

## 3. Блик, свечение, тень

| Токен | Light | Dark |
|---|---|---|
| rim width | 1 px | 1 px |
| rim: сторона света (верх-лево) | `rgb(255 255 255 / .90)` | `.50` |
| rim: боковые участки | `.14` | `.06` |
| rim: противоположная сторона | `.50` | `.24` |
| sheen (`inset 0 1px 1px`) | `.55` | `.22` |
| inner glow (`inset 0 0 18px`) | `.12` | `.05` |
| touch glow (радиальный, R = 90) | `.55` | `.30` |

Rim — это градиент по контуру под углом 135° (свет сверху-слева): `lit` 0 % → `side` 34 % → `side` 66 % → `opposite` 100 %. В шейдерах вместо градиента — `dot(normal, lightDir)`, см. [03-optics.md](03-optics.md).

**Тень regular (light):** `0 10 30 −6 rgb(0 0 0/.18)`, `0 2 8 0 rgb(0 0 0/.08)`, `0 0 0 0.5 rgb(0 0 0/.06)` (x y blur spread color).
**Тень regular (dark):** `0 12 36 −6 /.50`, `0 2 8 0 /.30`, `0 0 0 0.5 /.50`.
**Тень elevated (меню, sheets):** light `0 24 60 −10 /.28` + `0 4 14 0 /.10` + hairline; dark `0 28 70 −10 /.65` + `0 4 14 0 /.35` + hairline.

Там, где многослойной тени нет (WinUI `ThemeShadow`, Android `elevation`), бери один слой, близкий к первому, и hairline-обводку отдельно.

## 4. Рефракция

| Токен | Значение |
|---|---|
| bezel (ширина преломляющей кромки) | `clamp(minSide × 0.35, 8, 24)`, но не больше `minSide / 2` |
| strength (макс. смещение у самого края) | `bezel × 1.0` |
| IOR (показатель преломления) | 1.5 |
| профиль кромки | `h(t) = (1 − (1 − t)^p)^(1/p)`, `p = 3` |
| хроматическая аберрация | 0 на T2, 0.08 на T3 |
| направление света (шейдеры) | `(−0.6, −0.8)` в экранных координатах (y вниз) |

## 5. Геометрия и размеры

| Токен | Значение |
|---|---|
| радиусы | xs 8 · sm 12 · md 18 · lg 24 · xl 32 · 2xl 44 · capsule = h/2 |
| concentric | `max(r_parent − inset, 6)` |
| высота контролов | sm 28 (десктоп) · md 36 (десктоп, элементы в группе) · lg 44 (touch) · xl 52 |
| минимальная зона касания | Apple 44 · Android 48 · Windows touch 40 |
| tab bar | высота 62, padding 4, элемент ≥ 68 шириной, кнопка поиска — круг 62 |
| группа (остров тулбара) | padding 4, gap 2, элементы 36 × ≥ 36, радиус capsule |
| switch | 64 × 28, бегунок 38 × 24, при нажатии бегунок ×1.45 и становится clear-линзой |
| плавающий отступ | телефон: 16 по бокам, 12 над safe area снизу · планшет 20 · десктоп 24 |
| зазор между островами | 8 |
| дистанция слияния (container spacing) | 24 |
| высота scroll edge | 96 |

## 6. Типографика

Шкала iOS Dynamic Type «Large» (по умолчанию), размер / интерлиньяж / вес:

| Стиль | Значение | Стиль | Значение |
|---|---|---|---|
| largeTitle | 34 / 41 / 700 | body | 17 / 22 / 400 |
| title1 | 28 / 34 / 700 | callout | 16 / 21 / 400 |
| title2 | 22 / 28 / 700 | subheadline | 15 / 20 / 400 |
| title3 | 20 / 25 / 600 | footnote | 13 / 18 / 400 |
| headline | 17 / 22 / 600 | caption1 / caption2 | 12 / 16 / 400 · 11 / 13 / 400 |

На стекле: кнопка 15/600 (letter-spacing −0.01em), подпись вкладки 10/600, сегмент 13/600, пункт меню 15/500. На macOS/десктопе body — 13/16.

Шрифты: Apple — системный; web — `-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI Variable Text", "Segoe UI", Roboto, system-ui, sans-serif`; Windows — Segoe UI Variable (или Inter); Android — Inter / Roboto Flex. SF Pro на не-Apple не встраивать.

## 7. Цвет

| Токен | Light | Dark |
|---|---|---|
| label | `rgb(0 0 0 / .88)` | `rgb(255 255 255 / .94)` |
| secondaryLabel | `rgb(60 60 67 / .62)` | `rgb(235 235 245 / .60)` |
| indicator (выбранный сегмент/вкладка) | `rgb(120 120 128 / .18)` | `rgb(255 255 255 / .14)` |
| hover | `rgb(120 120 128 / .12)` | `rgb(255 255 255 / .10)` |
| фон страницы | `#F2F2F7` | `#000000` |
| accent (system blue) | `#0088FF` | `#0091FF` |

Остальная системная палитра (green, red, orange, …) — в JSON, `color.system`.

## 8. Движение

Все анимации — пружины. Значения в семантике SwiftUI (`response`, `dampingRatio`); для других платформ пересчитай утилитой:

```bash
node tools/spring.mjs --tokens          # таблица stiffness/damping для всех токенов
node tools/spring.mjs --tokens --css    # + CSS linear() easing
node tools/spring.mjs --response 0.35 --bounce 0.3   # произвольная пружина под все стеки
```

| Токен | response | dampingRatio | stiffness | damping | settle | Назначение |
|---|---|---|---|---|---|---|
| interactive | 0.15 | 0.86 | 1754.6 | 72.05 | 210 мс | элемент следует за пальцем |
| press | 0.22 | 0.65 | 815.7 | 37.13 | 363 мс | набухание при нажатии |
| release | 0.38 | 0.55 | 273.4 | 18.19 | 764 мс | упругий возврат («желе») |
| snappy | 0.30 | 0.85 | 438.6 | 35.60 | 419 мс | выбор, тумблеры |
| morph | 0.42 | 0.78 | 223.8 | 23.34 | 555 мс | кнопка → меню, слияние |
| bouncy | 0.50 | 0.70 | 157.9 | 17.59 | 819 мс | появление небольшого стекла |
| smooth | 0.50 | 1.00 | 157.9 | 25.13 | 735 мс | sheets, панели, Reduce Motion |
| lead / trail | 0.24 / 0.42 | 0.80 / 0.74 | | | | края индикатора выбора |
| dismiss | 0.28 | 1.00 | | | | закрытие меню и поповеров |

Параметры взаимодействия: рост при нажатии `+8 px` по длинной стороне (`scale = 1 + 8 / maxSide`, не больше 1.12), растяжение при перетаскивании до 6 %, следование за пальцем до 4 px, rubber band `c = 0.55`, растяжение от скорости `min(0.22, |v| × 0.000385)`, индикатор-линза ×1.10.

## 9. Бюджет производительности

| | Мобильные | Десктоп |
|---|---|---|
| одновременно видимых стеклянных поверхностей с живым backdrop | ≤ 4 | ≤ 8 |
| из них с рефракцией | ≤ 2 | ≤ 4 |
| доля экрана под живым размытием | ≤ 35 % | ≤ 35 % |
| GPU-время на стекло за кадр | ≤ 2.5 мс | ≤ 2.5 мс |

Подробнее — [06-performance.md](06-performance.md).
