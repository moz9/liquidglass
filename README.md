# Liquid Glass для ИИ-агентов

Инструкции и инженерные примеры для интерфейсов **Liquid Glass**, близких к Apple iOS / macOS 26 и 27. На Apple — нативный материал; на Web, Windows, Android, Flutter и других платформах — реализация с проверкой оптики, читаемости и производительности. Числа и шейдеры проекта не являются внутренней спецификацией Apple.

**Агентам:** начинайте с [AGENTS.md](AGENTS.md). Адаптеры Claude, Cursor, Copilot и Gemini направляют к одним требованиям.

## Настройки Liquid Glass

В создаваемом продукте предусматривается ползунок **«Прозрачный → Плотный»**: живое превью, немедленное применение, сохранение между запусками и возврат к виду по умолчанию. Он регулирует материал и учитывает системную доступность. [Контракт настройки](docs/emulation.md#регулировка-liquid-glass-в-настройках); [ограничения native API](docs/apple-native.md#ползунок-приложения-и-системная-настройка).

## Актуальные маршруты

- [Apple 26/27](docs/apple-native.md): системные компоненты, различия поколений и доступность API.
- [Другие платформы](docs/emulation.md): источник backdrop, калибровка, ползунок и известные ограничения примеров.
- [Проверка результата](docs/08-checklist.md): визуальное сходство, взаимодействия, настройки и производительность.
- [Источники и границы проверки](docs/sources.md).

Новая редакция обновляет инструкции. Исходный демонстрационный runtime ещё не реализует все новые требования, включая ползунок; его нельзя автоматически считать готовой библиотекой.

| Материал: regular / clear / tinted / prominent, рефракция кромки (T2) | Шейдерное стекло (T3): капли сливаются |
|---|---|
| ![Варианты материала и компоненты эталонной веб-реализации](docs/img/preview-materials.png) | ![Слияние стеклянных капель в WebGL](docs/img/preview-droplets.png) |

*Скриншоты исходного web-demo (`reference/web/demo.html`) в Chromium, а не интерфейса Apple.*

## Что внутри

```
AGENTS.md                      точка входа для агентов: алгоритм, маршрут по стекам, золотые правила
docs/
  01-principles.md             что такое Liquid Glass, анатомия материала, иерархия, варианты
  02-tokens.md                 все числа: материал, блик, тени, рефракция, геометрия, типографика, пружины
  03-optics.md                 математика: SDF, преломление по Снеллиусу, карта смещений, блик, слияние капель
  04-components.md             кнопки, тулбары, таб-бар, сегменты, переключатели, меню, sheets, sidebar…
  05-motion.md                 «жидкие» анимации: пружины, набухание, «желе», капля-индикатор, морфинг, слияние
  06-performance.md            уровни качества T0–T3, бюджеты, ловушки платформ, профилирование
  07-accessibility.md          Reduce Transparency / Motion, контраст, forced colors, клавиатура
  08-checklist.md              проверка сходства, доступности, ползунка и производительности
  apple-native.md             актуальный нативный маршрут Apple 26/27
  emulation.md                актуальный маршрут имитации и ограничения исходных примеров
  sources.md                  первичные источники и границы проверки
platforms/
  apple.md                     SwiftUI / UIKit / AppKit — нативный Liquid Glass (26+) и backport
  web.md                       CSS/JS, React, Next, Vue, Nuxt, Svelte, Angular, Tailwind, Lit, WebGL, Electron, Tauri
  windows.md                   WinUI 3, UWP, WPF, WinForms, Avalonia, Uno, Win32
  android.md                   Jetpack Compose (GraphicsLayer + AGSL, Haze), Views, Compose Multiplatform
  flutter.md                   Flutter на всех платформах, Impeller-шейдер
  cross-platform.md            React Native / Expo, .NET MAUI, Qt / QML, Linux, Unity, Unreal, Godot
tokens/liquid-glass.tokens.json   токены в формате W3C Design Tokens (Style Dictionary v4)
reference/
  web/                         эталонная веб-реализация + демо (проверена в Chromium)
  shaders/                     GLSL (WebGL), AGSL/SkSL (Android, Skia), Flutter, HLSL (WPF), Godot
tools/
  spring.mjs                   пересчёт пружин под любой стек (SwiftUI, Compose, WinUI, Flutter, CSS…)
  visual-check.mjs             скриншоты по матрице тем/доступности + замер кадров (Playwright)
  check.mjs                    проверка согласованности репозитория
```

## Как подключить к своему проекту

**Вариант 1 — подмодуль** (агент видит файлы локально):

```bash
git submodule add https://github.com/moz9/liquidglass design/liquidglass
```

и добавьте в инструкции агента вашего проекта (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/…`, `.github/copilot-instructions.md`):

```md
## UI
Интерфейс делаем в стиле Liquid Glass. Перед любой работой с UI прочитай
design/liquidglass/AGENTS.md и следуй ему (пути в нём — относительно design/liquidglass/).
```

- **Claude Code:** в `CLAUDE.md` проекта можно импортировать файл напрямую: `@design/liquidglass/AGENTS.md`. Навык из `.claude/skills/liquid-glass/` можно скопировать в `.claude/skills/` проекта.
- **Cursor:** скопируйте `.cursor/rules/liquid-glass.mdc` в `.cursor/rules/` проекта и поправьте пути.
- **GitHub Copilot:** добавьте абзац выше в `.github/copilot-instructions.md` проекта.

**Вариант 2 — ссылкой.** Агенту с доступом в интернет достаточно написать: «Сделай UI в стиле Liquid Glass по инструкциям https://github.com/moz9/liquidglass — начни с AGENTS.md».

**Примеры запросов агенту:**
- «Сделай нижний таб-бар и верхний тулбар в стиле Liquid Glass для нашего Next.js-приложения».
- «Переведи главное окно WinUI 3 на Liquid Glass: плавающий тулбар, меню с морфингом, пружинные анимации».
- «Добавь в Compose-приложение стеклянные кнопки с рефракцией на Android 13+ и fallback для старых версий».

## Демо

```bash
npx http-server .          # в корне репозитория
# открыть http://localhost:8080/reference/web/demo.html
# параметры: ?tier=0|1|2  ?theme=light|dark
```

Исходное demo выбирает Chromium кандидатом на T2, Safari/Firefox — T1; фактическое преломление проверяйте в целевой версии движка. В демо: варианты материала, капля-индикатор (можно тянуть), бегунок-линза в переключателе, меню, вытекающее из кнопки, адаптивная светлость баров и WebGL-слияние капель.

## Важно

- Liquid Glass — дизайн-язык Apple. Проект не связан с Apple; значения для не-Apple платформ — исходные приближения, а на iOS/macOS 26+ основным путём служит нативный материал.
- Шрифты SF Pro и иконки SF Symbols лицензированы только для Apple-платформ — инструкции запрещают встраивать их в Android/Windows/web-сборки.
- API платформ в инструкциях соответствуют актуальным на момент написания SDK; агенты обязаны сверяться с установленными версиями и не выдумывать сигнатуры.
