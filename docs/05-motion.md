# 05. Движение: «жидкие» анимации

Liquid Glass без правильного движения выглядит как стеклянная наклейка. Здесь — правила и паттерны; значения пружин — в [02-tokens.md](02-tokens.md#8-движение), перевод под любой стек — `node tools/spring.mjs`.

## 1. Законы движения

1. **Только пружины** для всего, что имеет физический смысл (позиция, размер, масштаб, радиус, форма). Кривые Безье и фиксированные длительности — только для цвета и прозрачности (≤ 0.3 с, ease-out).
2. **Прерываемость.** Новая цель во время анимации не перезапускает её с нуля: пружина продолжает с текущими позицией и **скоростью**. Никаких `animation.cancel(); start(from: initial)`.
3. **Сохранение скорости жеста.** Когда палец отпускает элемент, скорость жеста становится начальной скоростью пружины (иначе «бросок» не ощущается).
4. **Стекло набухает, а не проседает.** При нажатии масштаб растёт (1.04–1.12), при отпускании возвращается с перелётом ниже 1 и затухающим колебанием.
5. **Форма перетекает, а не появляется.** Кнопка становится меню, вкладка-капля перетекает к новой вкладке, две капли сливаются. Fade/scale «из ниоткуда» — только когда источника нет.
6. **Композитор, а не layout.** Анимируй `transform`/`scale`/`translate`/`opacity` (и эквиваленты: `graphicsLayer`, Composition `Visual`, `RenderTransform`). Размер, отступы и радиус через layout — только для одного небольшого элемента за раз.
7. **Reduce Motion:** все пружины становятся критически задемпфированными (`dampingRatio = 1`, response ≤ 0.25), нет растяжений, «желе», наклонов и параллакса; морфинг заменяется crossfade 0.2 с.

## 2. Пружина: одна модель для всех стеков

Параметризация как в SwiftUI: `response` (период незатухающих колебаний, с) и `dampingRatio` (ζ; `bounce = 1 − ζ`). Для массы 1:

```
ω = 2π / response;   stiffness k = ω²;   damping c = 2ζω
```

| Стек | Как задать |
|---|---|
| SwiftUI | `.spring(response: r, dampingFraction: ζ)` или `.spring(duration: r, bounce: 1−ζ)` |
| UIKit | `UIView.animate(springDuration: r, bounce: 1−ζ)`; `UISpringTimingParameters(dampingRatio:…)` |
| Jetpack Compose | `spring(dampingRatio = ζ, stiffness = k)` |
| Android Views | `SpringAnimation` + `SpringForce().setDampingRatio(ζ).setStiffness(k)` |
| Flutter | `SpringDescription(mass: 1, stiffness: k, damping: c)` + `SpringSimulation` |
| WinUI 3 / UWP | `SpringVector3NaturalMotionAnimation`: `DampingRatio = ζ`, `Period ≈ response` |
| CSS | `transition: transform <settle>ms linear(…)` — точки генерирует `tools/spring.mjs --css` |
| JS (жесты) | класс `Spring` из `liquid-glass.js` (полу-неявный Эйлер, шаг 1/240 с, сохраняет скорость) |
| Motion / Framer Motion | `{ type: "spring", stiffness: k, damping: c, mass: 1 }` |
| React Native Reanimated | `withSpring(v, { mass: 1, stiffness: k, damping: c })` |
| Qt Quick | `FrameAnimation` + свой интегратор (как `Spring` в JS) — у `SpringAnimation` другая параметризация |

CSS `linear()` — это запись *готовой* кривой: она не прерываема с сохранением скорости. Для жестов и прерываемых анимаций в вебе используй JS-пружину, `linear()` — для простых переходов состояний (hover, checked, открытие).

## 3. Нажатие и отпускание («желе»)

```
onPress(point):
    glow.center = point; glow.opacity → 1 (80 мс)
    s = min(1 + 8 / maxSide, 1.12)                   // маленькие элементы набухают сильнее
    scaleX.spring(press) → s;  scaleY.spring(press) → s

onDrag(point):                                     // палец ещё на элементе или чуть за ним
    glow.center = point
    fx = rubberBand(point.x − center.x, width)  / width      // −1..1, с сопротивлением
    fy = rubberBand(point.y − center.y, height) / height
    translate.spring(interactive) → (fx, fy) × 8 px   // тянется к пальцу, максимум ~4 px
    scaleX.spring(interactive) → s × (1 + 0.06|fx| − 0.03|fy|)   // растяжение по оси движения
    scaleY.spring(interactive) → s × (1 + 0.06|fy| − 0.03|fx|)   // и сжатие поперёк (объём сохраняется)

onRelease():
    glow.opacity → 0 (450 мс, ease-out)
    scale.spring(release) → 1;  translate.spring(release) → 0     // скорость сохраняется → колебание
```

**Rubber band** (сопротивление как у iOS): `f(x, d) = sign(x) · (1 − 1 / (|x|·c/d + 1)) · d`, `c = 0.55`, `d` — размер элемента или контейнера. Используй для всего, что тянется за предел: sheet выше максимума, скролл за край, индикатор за крайнюю вкладку.

## 4. Растяжение от скорости (squash & stretch)

Быстро летящая капля вытягивается по направлению движения:

```
stretch = min(0.22, |v| × 0.000385)          // v в px/с
scaleAlong  = 1 + stretch
scaleAcross = 1 − stretch × 0.5              // приблизительное сохранение площади
```

Для 2D-движения поверни элемент по вектору скорости или (проще) растягивай X и Y независимо по `|vx|` и `|vy|` — так сделано в WebGL-демо.

## 5. Индикатор выбора: капля

Самая узнаваемая «жидкая» анимация. Левый и правый края индикатора — **две независимые пружины**:

```
select(target):
    movingRight = target.left > current.left
    leadingEdge  = movingRight ? right : left
    trailingEdge = movingRight ? left  : right
    leadingEdge.spring(lead:  response 0.24, ζ 0.80) → target edge
    trailingEdge.spring(trail: response 0.42, ζ 0.74) → target edge
render: x = left, width = right − left
```

Передний край убегает, задний догоняет → капля вытягивается и схлопывается с лёгким перелётом.

**Перетаскивание (линза).** Нажал на бар и повёл: индикатор становится прозрачной линзой (clear, яркий контур, ×1.10), обе кромки идут за пальцем пружиной `interactive`, при отпускании — к ближайшему элементу пружинами lead/trail, масштаб 1 — пружиной `release`. На T2+ линза может увеличивать контент под собой (рефракция с `strength` ≈ 1.5 × bezel).

Эталон: `liquidIndicator()` в [`liquid-glass.js`](../reference/web/liquid-glass.js).

## 6. Морфинг: кнопка → меню / поповер / поле

Одна стеклянная поверхность меняет прямоугольник и радиус; источник исчезает в момент старта.

```
open(source, panel):
    S = rect(source), P = rect(panel), r0 = min(S.w, S.h)/2, r1 = panel.radius
    progress.spring(morph) 0 → 1
    each frame, t = progress (может перелетать за 1):
        rect   = lerp(S, P, t)
        radius = lerp(r0, r1, clamp(t, 0, 1))
        // FLIP: панель уже в финальном layout, двигаем transform-ом
        panel.transform = translate(rect.xy − P.xy) · scale(rect.w/P.w, rect.h/P.h)
        panel.cornerRadius = radius / scale        // компенсация: углы не сплющиваются
        content.transform  = scale(P.w/rect.w, P.h/rect.h)   // контент не искажается
        content.opacity    = clamp((t − 0.55) / 0.45, 0, 1)
        source.opacity     = t > 0.02 ? 0 : 1
close(): progress.spring(dismiss) → 0, затем скрыть панель и вернуть источник и фокус
```

Нативные эквиваленты: SwiftUI `glassEffectID` + `@Namespace` внутри `GlassEffectContainer` (и `matchedGeometryEffect` для не-стекла); Compose `SharedTransitionLayout` / `sharedBounds`; WinUI `ConnectedAnimationService` или ручной FLIP на Composition `Visual`; Flutter `Hero`/кастомный `AnimatedBuilder`; web — эталон `morphOpen()` или View Transitions API (снимки там статичны — для коротких переходов допустимо).

## 7. Слияние и разделение

**Настоящее слияние** возможно только когда стекло рисует один шейдер по общему SDF (`smin`, см. [03-optics.md](03-optics.md#2-слияние-капель-smooth-union)) или платформа делает это сама (SwiftUI `GlassEffectContainer(spacing:)`, UIKit `UIGlassContainerEffect`, AppKit `NSGlassEffectContainerView`).

Анимация: двигай формы пружиной `morph` — слияние/разделение получится само, потому что шейдер пересчитывает SDF каждый кадр. Эталон: секция T3 в `demo.html`.

**Без шейдера** (DOM, XAML, Views) — имитации, по возрастанию стоимости:
1. *Перетекание одной поверхностью:* вместо двух элементов, которые «сливаются», анимируй один, меняющий ширину (две кнопки → одна капсула) — пружиной `morph`, с компенсацией радиуса.
2. *Перемычка:* пока элементы ближе `mergeDistance`, между ними — третий стеклянный элемент-мост той же высоты с вогнутыми краями (`mask` радиальными градиентами), его ширина/прозрачность — функция расстояния. Работает, если элементы в одном ряду.
3. *Gooey-фильтр* (`feGaussianBlur` + `feColorMatrix` с порогом альфы) — только для **непрозрачных** форм (например, индикатора), с backdrop-стеклом несовместим.

## 8. Материализация и исчезновение

- **Появление (materialize):** стекло «конденсируется»: scale 0.8 → 1 (`bouncy`), непрозрачность 0 → 1 (0.2 с), размытие и рефракция нарастают вместе с прозрачностью (не анимируй радиус blur покадрово на слабых платформах — достаточно opacity всего слоя). В SwiftUI — `.glassEffectTransition(.materialize)`, в UIKit — установка `effect` у `UIVisualEffectView` внутри анимации.
- **Исчезновение:** быстрее, без отскока (`dismiss`), scale → 0.9, opacity → 0.

## 9. Таб-бар: сворачивание при прокрутке

- Прокрутка вниз больше ≈ 40 px от последнего разворота → свернуть: вкладки кроме выбранной уезжают/гаснут, бар сужается до круга/капсулы выбранной, подписи исчезают (opacity 0.15 с), пружина `smooth`. Дополнительный аксессуар (мини-плеер) может встать рядом в той же строке.
- Прокрутка вверх или тап по свёрнутому бару → развернуть той же пружиной.
- Не сворачивать при Reduce Motion? Сворачивать можно, но без перелёта (ζ = 1).

## 10. Sheets

Перетаскивание — пружина `interactive` за пальцем, за пределами крайних detent — rubber band. Отпускание: цель — detent, в сторону которого указывает скорость (`|v| > 500 px/с`) или ближайший; пружина `smooth` с начальной скоростью жеста. При переходе в полную высоту заливка плавно становится solid (0.3 с), нижние углы — 0.

## 11. Scroll edge effect

Не анимация, а постоянный слой: у края экрана, где над контентом висит стекло, контент растворяется — полоса высотой 96 с размытием 6 и градиентом цвета фона 55 % → 0 %, маской 35 % → 0 %. Слой адаптивен (цвет — по виду секции под ним). На слабых устройствах — только градиент без размытия.

## 12. Живой блик

Опционально (T3): спекулярный контур вращается вслед за наклоном устройства (±15°, low-pass фильтр 0.1, обновление не чаще кадра) или едва заметно смещается к курсору на десктопе. Никогда при Reduce Motion и в режиме энергосбережения.

## 13. Тактильная отдача

Там, где платформа даёт haptics: лёгкий импульс при защёлкивании индикатора на вкладке, при переключении тумблера и при достижении detent. iOS — `.sensoryFeedback(.selection, trigger:)`; Android — `HapticFeedbackConstants.CLOCK_TICK` / `SEGMENT_TICK`; web — `navigator.vibrate(8)` только там, где это уместно и поддерживается.

## 14. Контроль качества движения

- Проверь на 60 и 120 Гц: интегратор пружины должен зависеть от `dt`, а не от номера кадра.
- Прерви каждую анимацию на середине (быстрые повторные тапы, смена направления) — не должно быть рывков и телепортаций.
- Запиши экран и просмотри покадрово: у капли-индикатора передний край должен явно опережать задний, у кнопки после отпускания — одно-два затухающих колебания, не больше.
