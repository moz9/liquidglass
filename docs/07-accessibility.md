# 07. Доступность

> Этот документ описывает исходные приближения и приёмы примеров. Приоритет имеют [AGENTS.md](../AGENTS.md), [Apple 26/27](apple-native.md), [ограничения реализации](emulation.md) и [актуальная приёмка](08-checklist.md). Числа и реакции не являются универсальными требованиями Apple; настройки плотности и доступности проверяются отдельно.

Системные настройки пользователя всегда важнее стиля. Стекло должно оставаться читаемым и управляемым для всех.

## 1. Матрица настроек

| Настройка | Что делать | Web | Apple | Android | Windows | Flutter |
|---|---|---|---|---|---|---|
| **Уменьшить прозрачность** | T0: непрозрачная заливка alpha 1, без backdrop и рефракции; исходное `material.solid` с alpha .97 при переносе исправить | `@media (prefers-reduced-transparency: reduce)` | нативно; для своих слоёв `@Environment(\.accessibilityReduceTransparency)` / `UIAccessibility.isReduceTransparencyEnabled` | системной нет — настройка в приложении | `UISettings.AdvancedEffectsEnabled == false` (+ событие `AdvancedEffectsEnabledChanged`) | настройка приложения; на iOS — через platform channel |
| **Повышенный контраст** | solid-заливка, контур цвета `secondaryLabel` → `label`, вторичный текст = основной, толще фокус | `@media (prefers-contrast: more)` | `\.colorSchemeContrast == .increased` | «Текст высокой контрастности» — недоступен через публичный API, дай настройку | `AccessibilitySettings.HighContrast` | `MediaQuery.highContrastOf(context)` |
| **Принудительные цвета / высокий контраст** | убрать стекло целиком: системные цвета `Canvas`/`CanvasText`/`Highlight`, обводка 1 px | `@media (forced-colors: active)` | — | — | High Contrast themes (`{ThemeResource SystemColor…}`) | — |
| **Уменьшить движение** | пружины с ζ = 1, без растяжений, «желе», наклона и параллакса; морфинг → crossfade 0.2 с | `@media (prefers-reduced-motion: reduce)` | `\.accessibilityReduceMotion` | `Settings.Global.ANIMATOR_DURATION_SCALE == 0` (+ проверка «Убрать анимацию») | `UISettings.AnimationsEnabled == false` | `MediaQuery.disableAnimationsOf(context)` |
| **Крупный текст** | контейнеры адаптируются к тексту; не прячь подписи исключительно в long-press tooltip, сохраняй доступные имена и читаемое представление | `rem`/`em`, без фиксированной высоты у текстовых кнопок | Dynamic Type | `sp`, fontScale | `UISettings.TextScaleFactor` | `MediaQuery.textScalerOf` |
| **Тема** | light/dark вид стекла и меток | `prefers-color-scheme` | нативно | `isSystemInDarkTheme()` | `ActualTheme` | `MediaQuery.platformBrightnessOf` |

Исходная CSS содержит обработку media queries, но имеет ограничения fallback для solid/prominent. Проверь все варианты и изменения настроек во время работы по [актуальному маршруту](emulation.md). Ползунок плотности не может переопределить системную доступность.

## 2. Контраст на стекле

- Текст и иконки на стекле: ≥ 4.5:1 (текст < 18 pt), ≥ 3:1 (крупный текст, иконки, контуры управляющих элементов).
- Проверяй **на худшем реальном фоне** после композиции заливки и backdrop: белом, чёрном и пёстром. Для цвета текста используй заданный foreground с учётом alpha, а не сглаженный край glyph; скриншот помогает проверить фон и визуальные дефекты.
- Если не хватает: (1) переключи элемент в адаптивный вид (светлые символы над тёмным); (2) увеличь fill; (3) для clear — затемняющий слой под стеклом; (4) перейди на thick.
- Метки на стекле жирнее (≥ 500) — тонкий текст на подвижном фоне читается хуже.

## 3. Фокус и клавиатура

- Каждый интерактивный элемент на стекле достижим с клавиатуры, фокус виден: кольцо 2 px accent с отступом 2 px (контрастнее стекла на любом фоне).
- Таб-бар и сегменты — `tablist` с roving tabindex и стрелками. Меню — `menu`/`menuitem`, стрелки ↑/↓, Esc закрывает и возвращает фокус на источник.
- Морфинг меню не должен терять фокус: фокус переходит в меню после старта анимации и возвращается на кнопку после закрытия.

## 4. Экранные читалки

- Стекло — декорация: слои блика, свечения, scroll edge помечай `aria-hidden` / `importantForAccessibility="no"` / `AutomationProperties.AccessibilityView="Raw"`.
- Иконочные кнопки — с текстовыми метками (`aria-label`, `accessibilityLabel`, `contentDescription`, `AutomationProperties.Name`).
- Состояния: `aria-selected`, `aria-expanded`, `aria-checked` / `role="switch"`.

## 5. Движение и вестибулярные нарушения

- Ни одна анимация не должна быть обязательной для понимания интерфейса.
- Параллакс блика от гироскопа и растяжение по скорости — только при выключенном Reduce Motion.
- Никаких бесконечных анимаций стекла в покое («переливы», «дыхание»).

## 6. Размеры касания

Apple ≥ 44 × 44 pt, Android ≥ 48 × 48 dp, Windows touch ≥ 40 × 40 epx. Если визуально элемент меньше (иконка 36 в группе), расширь зону касания без изменения визуала.
