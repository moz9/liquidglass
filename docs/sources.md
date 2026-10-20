# Источники и границы проверки

Редакция: **2026-10-20**. Приоритет — прозрачный материал с подтверждённым backdrop, blur и линзой; плотный режим не подменяет этот запрос. Добавлены проверка перекрывающих заливок, оптическое сравнение и ползунок плотности в эталонном demo.

Исходная инженерная база — [moz9/liquidglass, d6dacca8](https://github.com/moz9/liquidglass/commit/d6dacca8f8c6f5274547ea1b78898df28fbe3add). Токены, шейдеры и компонентное demo остаются приближениями. [optics.html](../reference/web/optics.html) использует существующий renderer с прозрачной калибровкой и реализует ползунок для сравнения материалов; это не новая универсальная библиотека. Ограничения исходного runtime перечислены в [emulation.md](emulation.md).

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

2026-10-20: эталонный [demo.html](../reference/web/demo.html) переведён на новый маршрут — ползунок «Liquid Glass» в панели внешнего вида, живое превью, сохранение значения, секция оптики с A/B линзы и blur над движущейся сеткой. База проверки — рабочее дерево поверх коммита `f56d1b6`; среда — Chromium 1243 (Playwright 1.63.0, headless, Windows 11), страница отдаётся локальным HTTP-сервером.

Замеры выполнены по computed style слоя `::before` (alpha заливки) и по цепочке `backdrop-filter` при переключении режимов:

| Вариант | density 0 (прозрачный) | density 50 (по умолчанию) | density 100 (плотный) |
|---|---|---|---|
| Regular, light / dark | .068 / .122 | .134 / .241 | .20 / .36 |
| Clear, light / dark | .020 / .020 | .040 / .040 | .060 / .060 |
| Thick, light / dark | .245 / .245 | .482 / .482 | .72 / .72 |
| Tinted (accent) | .234 | .267 | .30 |
| Prominent (accent) | .86 | .86 | .86 |

Плотный конец совпадает с калиброванными токенами репозитория; `prominent` намеренно не слабеет. В непрозрачном режиме (T0, Reduce Transparency, повышенный контраст) alpha всех вариантов равен 1, `backdrop-filter` выключен — раньше `prominent` оставался на .86, а solid был .97. Проверено: сохранение значения после перезагрузки, возврат «По умолчанию», влияние ползунка на таб-бар, кнопки, плитку оптики и превью, блокировка ползунка при Reduce Transparency и forced colors с сохранением выбранного значения, работа A/B линзы (три разные цепочки фильтров), отсутствие ошибок страницы.

Кадры. Медиана кадра — 16.7 ms в обеих версиях. Доля кадров дольше 30 ms (мера `visual-check.mjs`): база `f56d1b6` — 1.4–12.8 %, медиана 2.7 %; новая сборка — 8.7–23.1 %, медиана 17.5 %; n = 6 на сторону, замеры чередующиеся в одном прогоне, один harness, окно 1280×860, headless Chromium 1243. Разница соответствует живой линзе над анимированным фоном в новой секции «Оптика»: пока секция на экране, backdrop перерисовывается каждый кадр. Отдельно замерено на машине под нагрузкой: та же метрика гуляла от 0.7 % до 39 % для **неизменной** сборки — в headless она годится только для сравнения внутри одного чередующегося прогона. Поведение на реальном устройстве не измерено; неизвестно также, сколько кадров стоит секция вне headless.

Не подтверждено этим прогоном: Safari и Firefox, реальные мобильные и десктопные GPU, физическое время отклика, поведение на устройствах Apple, сходство с Apple, калибровка профиля 27, а также сам факт T2 вне Chromium (название движка и `tier=2` доказывают только кандидат). Форс-колоры проверялись эмуляцией Chromium, а не в Windows High Contrast.

2026-10-20 (исправления по итогам разбора, база `431f701`): режимы A/B линзы больше не переопределяют свойство `backdrop-filter` — они меняют только то, что берёт материал (линза подключается/отключается через `enhance`, рассеивание — через `--lg-blur`), поэтому `prefers-reduced-transparency`, `prefers-contrast: more` и forced colors выключают выборку фона во всех трёх режимах. Повышенный контраст в библиотеке теперь тоже выключает `backdrop-filter`: поверхность и так непрозрачна, sampling был пустой работой. Модальная панель внешнего вида удерживает клавиатурный фокус (Tab/Shift+Tab замыкаются внутри, фон получает `inert`) и возвращает фокус при закрытии. На узких экранах переключатель оптики делит ширину между пунктами, а плавающая верхняя панель остаётся в одну строку.

Проверено на этой базе: 15/15 поведенческих проверок, 9/9 проверок на дефекты (A/B против трёх системных режимов, ловушка фокуса, отсутствие горизонтального переполнения на 390/360/320 px), `optics.html` не изменился, ошибок страницы нет. Не проверено: реальные мобильные устройства, другие движки, поведение `inert` в старых браузерах (там остаётся ловушка фокуса).

2026-10-20 (по итогам независимого разбора, база `aa4d483`): исправлена регрессия — режим «Только линза» больше не возвращает рассеивание, когда движок не умеет преломлять (уровень T1): рассеивание отключается по режиму, а не по уровню. В библиотеке нажатый бегунок переключателя в непрозрачных режимах становится непрозрачным и перестаёт выбирать фон, scroll edge больше не размывает текст при повышенном контрасте, а принудительный уровень не может перебить системную доступность. `prominent` намеренно не следует за плотностью: у подписанного действия должен оставаться контраст — исключение зафиксировано в [02-tokens.md](02-tokens.md#плотность-материала).

Проверки вынесены в `tools/material-check.mjs` и воспроизводимы любым желающим: `npm i -D playwright && npx playwright install chromium`, затем `node tools/material-check.mjs <url>`. На текущей базе — 36/36 (alpha вариантов, непрозрачность в T0/Reduce Transparency/повышенном контрасте/forced colors, нажатый бегунок, приоритет доступности над принудительным уровнем, настройка плотности, A/B оптики, фокус в модальном окне, отсутствие переполнения на 390/360/320 px). Разбор был статическим: он подтвердил D1 и D2 по коду, но ширины и рантайм в браузере проверить не мог — их закрыл прогон инструмента.

2026-10-01: `reference/web/optics.html` запущен в Chromium встроенного браузера Codex. Визуально проверены blur и изгиб наклонных линий у кромки, сдвиг живого DOM-фона, light/dark; через UI проверены крайние значения плотности, сохранение после reload, сброс, ручной Reduce Transparency и восстановление линзы. В непрозрачном режиме computed fill имеет alpha 1 и backdrop-filter выключен. Ошибок страницы при этих действиях не наблюдалось. Системные forced colors, Safari, производительность мобильного GPU и сходство с Apple этим прогоном не подтверждены.

Изучены исходный код, официальные документы и текстовые расшифровки выступлений Apple. Выполняется проверка ссылок и согласованности репозитория. Видео не отсмотрены покадрово; нативные приложения Apple/Android/Flutter не собраны и не сравнены с устройствами Apple. Применение инструкций требует проверки конкретного продукта по [чек-листу](08-checklist.md).

Маршруты native 26/27, старой Apple OS, web без подтверждённого SVG, WPF и Flutter проверены при редактуре. Это проверка инструкций, не независимый прогон агента и не доказательство качества будущего приложения.
