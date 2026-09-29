# Liquid Glass — инструкции для ИИ-агентов

Этот репозиторий учит агента делать интерфейсы в стиле **Liquid Glass** (материал и дизайн-язык Apple iOS / iPadOS / macOS 26–27) на любой платформе: Apple, Web, Windows, Android, Flutter, React Native, .NET MAUI, Qt, Linux, игровые движки — максимально близко к оригиналу и без просадок производительности.

Это файл-точка входа. **Прочитай его целиком**, затем — документы из маршрута своего стека. Пути ниже — относительно корня этого репозитория (если он подключён подмодулем, например в `design/liquidglass/`, добавляй этот префикс).

---

## 1. Алгоритм работы

1. **Определи стек и целевые версии ОС.** Подсказки: `Package.swift`/`*.xcodeproj` → Apple; `package.json` (react, next, vue, nuxt, svelte, @angular/core, tailwindcss, expo, react-native, electron, @tauri-apps) → Web/RN/desktop-web; `*.csproj` (`Microsoft.WindowsAppSDK`, `UseWPF`, `UseWindowsForms`, `Avalonia`, `Uno`, `Microsoft.Maui`) → Windows/MAUI; `build.gradle(.kts)` с `compose` → Android; `pubspec.yaml` → Flutter; `CMakeLists.txt` с `Qt6` → Qt; `project.godot`, `ProjectSettings/`, `*.uproject` → движки.
2. **Прочитай обязательное:** [docs/01-principles.md](docs/01-principles.md) → [docs/02-tokens.md](docs/02-tokens.md) → [docs/05-motion.md](docs/05-motion.md) → [docs/08-checklist.md](docs/08-checklist.md). По необходимости: [03-optics](docs/03-optics.md) (если пишешь шейдер/фильтр), [04-components](docs/04-components.md) (размеры и состояния компонентов), [06-performance](docs/06-performance.md), [07-accessibility](docs/07-accessibility.md).
3. **Прочитай гайд платформы** (таблица §2) и возьми эталонный код из `reference/`.
4. **Apple 26+ → только нативные API** (`glassEffect`, `UIGlassEffect`, `NSGlassEffectView`). Имитация там запрещена. Остальные платформы → уровни качества T0–T3 (§5).
5. **Порядок реализации:** токены/тема (один модуль) → базовый материал (один компонент `Glass`) → компоненты → движение → уровни и доступность. Все числа — из токенов, а не «на глаз».
6. **Проверка:** скриншоты (светлая/тёмная тема × фон белый / чёрный / пёстрый × уровни T0/T1/T2), профилирование на слабом целевом устройстве, пункты [08-checklist.md](docs/08-checklist.md).
7. **Отчёт пользователю** по шаблону из [08-checklist.md §3](docs/08-checklist.md#3-что-сообщить-пользователю-по-завершении): что сделано, какие уровни где включаются, что на этой платформе приближённо, как проверено.

## 2. Маршрут по стекам

| Стек | Гайд | Эталонный код |
|---|---|---|
| SwiftUI, UIKit, AppKit, watchOS, tvOS, visionOS | [platforms/apple.md](platforms/apple.md) | нативные API; Metal-линза для своего контента |
| HTML/CSS/JS, React, Next.js, Vue, Nuxt, Svelte, Angular, Tailwind, Lit, Electron, Tauri | [platforms/web.md](platforms/web.md) | [reference/web/](reference/web/) — `liquid-glass.css`, `liquid-glass.js`, `liquid-glass.tailwind.css` |
| Canvas / WebGL / Three.js / PixiJS | [platforms/web.md §8](platforms/web.md#8-t3-webgl) | [reference/web/liquid-glass-webgl.js](reference/web/liquid-glass-webgl.js), [reference/shaders/liquid-glass.frag.glsl](reference/shaders/liquid-glass.frag.glsl) |
| WinUI 3, UWP, WPF, WinForms, Avalonia, Uno, Win32 | [platforms/windows.md](platforms/windows.md) | [LiquidGlass.wpf.hlsl](reference/shaders/LiquidGlass.wpf.hlsl) (WPF), [liquid-glass.agsl](reference/shaders/liquid-glass.agsl) (SkSL для Skia-стеков) |
| Jetpack Compose, Android Views, Compose Multiplatform | [platforms/android.md](platforms/android.md) | [reference/shaders/liquid-glass.agsl](reference/shaders/liquid-glass.agsl) |
| Flutter (все платформы) | [platforms/flutter.md](platforms/flutter.md) | [reference/shaders/liquid_glass.frag](reference/shaders/liquid_glass.frag) |
| React Native / Expo, .NET MAUI, Qt / QML, GTK, KDE, Unity, Unreal, Godot | [platforms/cross-platform.md](platforms/cross-platform.md) | [liquid-glass.gdshader](reference/shaders/liquid-glass.gdshader) (Godot) |

Стек не в списке — возьми ближайший по модели рендеринга (есть ли backdrop-фильтр? пиксельные шейдеры над фоном? пружинные анимации?) и следуй [03-optics.md](docs/03-optics.md) + [06-performance.md](docs/06-performance.md).

## 3. Золотые правила

1. **Стекло только в слое навигации и управления** (бары, тулбары, плавающие кнопки, поиск, меню, sheets). Контент — карточки, списки, фон экрана — **не стекло**.
2. **Нет стекла на стекле.** Внутри стеклянной панели элементы плоские; группа действий — одна стеклянная капсула.
3. **Это линза, а не матовое стекло:** лёгкое размытие (σ 10 regular, 2 clear), насыщенность ×1.8, заливка ≈ 20 %, преломление у кромки, направленный блик. Сильный blur + молочная заливка + белая рамка = glassmorphism, это ошибка.
4. **Капсулы и концентричность:** кнопки/бары/поля — капсулы; вложенные радиусы `r_parent − inset`; элементы парят с отступом от краёв.
5. **Контент edge-to-edge под стеклом,** вместо разделителей — scroll edge effect.
6. **Адаптивность:** небольшие стеклянные элементы переключают светлый/тёмный вид по контенту под ними.
7. **Всё движение — пружины из токенов,** прерываемые, с сохранением скорости. Нажатие *набухает* (до ×1.12) и светится из точки касания; индикатор выбора — капля с двумя краями; меню морфится из кнопки.
8. **Анимируй только transform/opacity** (и эквиваленты композитора). Никогда — радиус размытия.
9. **Уровни качества обязательны** на не-Apple платформах: T0 solid / T1 frosted / T2 lens / T3 liquid; понижение при просадках кадров.
10. **Доступность главнее стиля:** Reduce Transparency → solid, Increase Contrast → solid + контраст, forced colors → системные цвета, Reduce Motion → без отскоков; текст ≥ 4.5:1 на худшем фоне.
11. **Не выдумывай API.** Используй то, что описано здесь и в SDK. Если сомневаешься в сигнатуре — проверь документацию установленной версии и отметь в отчёте.
12. **Лицензии Apple:** SF Pro и SF Symbols не встраивать в приложения для не-Apple платформ; логотипы и ассеты Apple не копировать.

## 4. Материал за 30 секунд

Слои снизу вверх (числа — light / dark):

| Слой | Значение |
|---|---|
| тень | `0 10 30 −6 rgba(0,0,0,.18)` + `0 2 8 rgba(0,0,0,.08)` / `.50` + `.30` — только снаружи формы |
| backdrop | рефракция кромки (T2) → blur σ 10 → saturate 1.8 → brightness 1.05 / 0.92 |
| заливка | `rgba(255,255,255,.20)` / `rgba(30,30,34,.36)`; thick (меню, sheets): `.72`, σ 24; clear: `.06`, σ 2 |
| свечение касания | радиальный градиент R 90 из точки касания, белый `.55` / `.30` |
| блик (rim) | 1 px, градиент 135°: `.90 → .14 → .14 → .50` / `.50 → .06 → .06 → .24` + inset sheen сверху |
| контент | метки `rgba(0,0,0,.88)` / `rgba(255,255,255,.94)`, вес ≥ 500 |

Рефракция: полоса у кромки `bezel = clamp(0.35 × minSide, 8, 24)`, смещение выборки **внутрь** по нормали, сила = bezel, профиль Снеллиуса (IOR 1.5) — формулы в [03-optics.md](docs/03-optics.md).

## 5. Уровни качества

| Tier | Содержимое | Типичные платформы |
|---|---|---|
| T0 solid | непрозрачная поверхность, тот же силуэт, rim, тень | Reduce Transparency, высокий контраст, нет backdrop-API |
| T1 frosted | живой blur + saturation + fill + rim + тень + свечение | Safari, Firefox, Android 12, WinUI (Composition), WPF, Skia-бэкенд Flutter |
| T2 lens | T1 + рефракция кромки | Chromium, Android 13+, Flutter Impeller |
| T3 liquid | T2 + шейдерное слияние капель, дисперсия, живой блик | свой рендер (WebGL, Metal, Skia, движки) — по явному решению |

## 6. Движение за 30 секунд

Пружины (`response` с / `dampingRatio`): interactive 0.15/0.86 · press 0.22/0.65 · release 0.38/0.55 · snappy 0.30/0.85 · morph 0.42/0.78 · bouncy 0.50/0.70 · smooth 0.50/1.0 · индикатор lead 0.24/0.80 + trail 0.42/0.74 · dismiss 0.28/1.0. Перевод в stiffness/damping, CSS `linear()` и API любого стека:

```bash
node tools/spring.mjs --tokens --css
node tools/spring.mjs --response 0.35 --bounce 0.3
```

## 7. Инструменты

| Команда | Зачем |
|---|---|
| `node tools/spring.mjs …` | параметры пружин под любой стек |
| `node tools/visual-check.mjs <url>` | web: скриншоты по матрице тем и настроек доступности + замер кадров при скролле (нужен Playwright) |
| `npx http-server .` → `/reference/web/demo.html?tier=2&theme=dark` | живое демо эталона |
| `node tools/check.mjs [--write]` | согласованность токенов, CSS, JS, шейдеров и ссылок — после любой правки **этого** репозитория |

## 8. Если ты правишь этот репозиторий

- Источник истины значений — [tokens/liquid-glass.tokens.json](tokens/liquid-glass.tokens.json); пружины — `MOTION_TOKENS` в [tools/spring.mjs](tools/spring.mjs). Изменил — синхронизируй `reference/web/liquid-glass.js` (`MOTION`), таблицы в `docs/02-tokens.md` и выполни `node tools/check.mjs --write`.
- GLSL-шейдер правится только в `FRAGMENT_SHADER` ([reference/web/liquid-glass-webgl.js](reference/web/liquid-glass-webgl.js)); копия `reference/shaders/liquid-glass.frag.glsl` генерируется. Порты (AGSL, Flutter, HLSL, Godot) обновляй вручную по той же модели.
- Правку веб-эталона проверяй демо-страницей и `tools/visual-check.mjs` (скриншоты глазами, не только цифры).
- Документация — на русском, код и комментарии в коде — на английском.
