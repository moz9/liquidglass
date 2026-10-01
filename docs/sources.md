# Источники и границы проверки

Редакция: **2026-10-01**. Приоритет — прозрачный материал с подтверждённым backdrop, blur и линзой; плотный режим не подменяет этот запрос. Добавлены проверка перекрывающих заливок и оптическое сравнение.

Исходная инженерная база — [moz9/liquidglass, d6dacca8](https://github.com/moz9/liquidglass/commit/d6dacca8f8c6f5274547ea1b78898df28fbe3add). Токены, шейдеры и компонентное demo остаются приближениями. Новый [optics.html](../reference/web/optics.html) использует существующий renderer с прозрачной калибровкой и реализует ползунок для сравнения материалов; это не новая универсальная библиотека. Ограничения исходного runtime перечислены в [emulation.md](emulation.md).

## Проверенные первичные материалы

| Источник | Для чего использован |
|---|---|
| [Meet Liquid Glass, WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/) | Роль материала, адаптация и разделение слоёв |
| [Get to know the new design system, WWDC25](https://developer.apple.com/videos/play/wwdc2025/356/) | Геометрия, различие плотного desktop и touch UI |
| [Build a SwiftUI app with the new design](https://developer.apple.com/videos/play/wwdc2025/323/) | Системная компоновка и button styles |
| [Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass) | Внедрение системных компонентов и доступность |
| [Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views) | Shapes, containers, ID, union и порядок modifiers |
| [Platforms State of the Union, WWDC26](https://developer.apple.com/videos/play/wwdc2026/102/) | Изменения версии 27 и пользовательская настройка |
| [Keynote, WWDC26](https://developer.apple.com/videos/play/wwdc2026/101/) | Визуальное направление 27 для калибровки имитации |
| [What’s new in SwiftUI, WWDC26](https://developer.apple.com/videos/play/wwdc2026/269/) | Обновлённый native appearance, интерактивность Mac |
| [SwiftUI Group Lab, WWDC26](https://developer.apple.com/videos/play/wwdc2026/8120/) | Glass ButtonStyle, toolbar и предотвращение двойного материала |
| [UIGlassEffect](https://developer.apple.com/documentation/uikit/uiglasseffect), [NSGlassEffectView](https://developer.apple.com/documentation/appkit/nsglasseffectview) | Публичные native-типы |
| [Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica), [Acrylic](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic), [CompositionBackdropBrush](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.composition.compositionbackdropbrush) | Различие Windows-материалов и источников backdrop |
| [MDN backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter) | Модель фильтрации на web |
| [Android AGSL](https://developer.android.com/develop/ui/views/graphics/agsl/agsl-vs-glsl), [Flutter shader filter](https://api.flutter.dev/flutter/dart-ui/ImageFilter/ImageFilter.shader.html) | Ограничения платформенного shader input/backend |
| [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) | Проверка контраста текста и controls |

Руководства актуальны на дату чтения; конкретный API и поддержку проверяй по SDK/версии продукта. Численные рекомендации имитации и критерии практической проверки — инженерные решения этого скилла, если рядом не указано иное.

## Границы этой редакции

2026-10-01: `reference/web/optics.html` запущен в Chromium встроенного браузера Codex. Визуально проверены blur и изгиб наклонных линий у кромки, сдвиг живого DOM-фона, light/dark; через UI проверены крайние значения плотности, сохранение после reload, сброс, ручной Reduce Transparency и восстановление линзы. В непрозрачном режиме computed fill имеет alpha 1 и backdrop-filter выключен. Ошибок страницы при этих действиях не наблюдалось. Системные forced colors, Safari, производительность мобильного GPU и сходство с Apple этим прогоном не подтверждены.

Изучены исходный код, официальные документы и текстовые расшифровки выступлений Apple. Выполняется проверка ссылок и согласованности репозитория. Видео не отсмотрены покадрово; нативные приложения Apple/Android/Flutter не собраны и не сравнены с устройствами Apple. Применение инструкций требует проверки конкретного продукта по [чек-листу](08-checklist.md).

Маршруты native 26/27, старой Apple OS, web без подтверждённого SVG, WPF и Flutter проверены при редактуре. Это проверка инструкций, не независимый прогон агента и не доказательство качества будущего приложения.
