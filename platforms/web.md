# Web

Эталонная реализация — [`reference/web/`](../reference/web/): `liquid-glass.css` (материал, компоненты, доступность), `liquid-glass.js` (рефракция, физика, индикатор, морфинг, адаптивность, уровни), `liquid-glass-webgl.js` (T3), `demo.html`. **Не пиши стекло с нуля — подключи эталон и строй компоненты на нём.** Если стек запрещает копирование файлов, перенеси логику один в один: в эталоне уже учтены неочевидные баги браузеров (см. §3).

## 0. Быстрый старт

```html
<link rel="stylesheet" href="/liquid-glass/liquid-glass.css" />
<script type="module">
  import { initLiquidGlass } from '/liquid-glass/liquid-glass.js';
  initLiquidGlass(); // определяет уровень, включает .lg-lens / .lg-interactive / [data-lg-adaptive]
</script>

<button class="lg lg-btn lg-interactive lg-lens">Готово</button>
```

Демо: `npx http-server .` в корне репозитория → `http://localhost:8080/reference/web/demo.html`. Параметры: `?tier=0|1|2`, `?theme=light|dark`. ES-модули не работают по `file://` — нужен любой локальный сервер.

## 1. Что умеют браузеры

| Возможность | Chromium (Chrome, Edge, Opera, Samsung, Electron) | Safari | Firefox |
|---|---|---|---|
| `backdrop-filter` blur/saturate/brightness | да | да (`-webkit-` для старых версий) | да |
| `backdrop-filter: url(#svg)` — **рефракция** | да | нет | нет |
| `prefers-reduced-transparency` | да | нет | нет (за флагом) |
| `linear()` easing, `@property`, `color-mix()` | да | да | да |
| WebGL2 (T3) | да | да | да |

Итог: **T2 (линза) — только Chromium**, Safari/Firefox получают T1. Это делает `detectTier()` автоматически; не пытайся «включить» SVG-рефракцию в Safari — фильтр молча не применится или отключит весь `backdrop-filter`.

## 2. Устройство `.lg`

```
.lg                   outer box-shadow (и ничего больше не рисует: background: none)
 ├─ ::before z:-1     backdrop-filter: [url(#refract)] blur(σ) saturate(1.8) brightness(…)
 │                    + fill + радиальное свечение касания + inset sheen
 ├─ контент
 └─ ::after  z:1      rim: 1px градиент 135°, вырезанный маской (mask-composite: exclude)
```

Переменные, которыми управляют модификаторы: `--lg-fill`, `--lg-blur`, `--lg-saturate`, `--lg-brightness`, `--lg-shadow`, `--lg-radius`, `--lg-tint`, `--lg-glow-k` (0–1, анимируется через `@property`), `--lg-px/--lg-py` (точка касания), `--lg-refract` (ставит JS). Вид (светлый/тёмный) — набор `--lgv-*`, переключается атрибутом `data-lg-appearance="light|dark"` на элементе или темой страницы (`prefers-color-scheme`, `html[data-theme]`).

## 3. Критичные ловушки браузеров (уже обойдены в эталоне)

1. **Chromium: внешняя тень убивает `backdrop-filter: url()`.** Если у элемента с SVG-фильтром в `backdrop-filter` есть рендер за пределами бокса (внешний `box-shadow`, даже у потомка), фильтр пропадает целиком — ни рефракции, ни размытия. Поэтому backdrop в `::before`, а тень — на самом элементе. Не переноси `box-shadow` на `::before`.
2. **Собственный фон элемента попадает в backdrop `::before`.** У `.lg` всегда `background: none`. `<button>` без этого размоет свой серый UA-фон и станет белым.
3. **Backdrop Root.** Предок с `opacity < 1`, `filter`, `mask`, `clip-path`, `backdrop-filter`, `mix-blend-mode` (или `will-change` на них) ограничивает видимый стеклу фон своим содержимым. Не делай fade-in панели со стеклом через `opacity` родителя — анимируй сам стеклянный элемент. Стекло внутри стекла видит только уже нарисованное родителем (поэтому индикатор внутри таб-бара — просто заливка).
4. **`color-interpolation-filters="sRGB"`** на SVG-фильтре обязателен, иначе карта смещений интерпретируется в linearRGB.
5. **Карта смещений привязана к размеру.** При ресайзе эталон снимает фильтр сразу и строит новый через 140 мс после стабилизации размера; нажатие меняет `scale` (transform), а не размер, поэтому карта остаётся валидной.
6. **JS анимирует свойства `scale` и `translate`** интерактивных элементов. Позиционируй стекло через `transform`, `inset`, margin — не через `scale`/`translate`, иначе они перезапишутся.

## 4. Классы

| Класс | Назначение |
|---|---|
| `lg` | базовый материал (regular) |
| `lg-clear` · `lg-thick` · `lg-tinted` · `lg-prominent` | варианты (tint через `--lg-tint`, по умолчанию accent) |
| `lg-dim` | затемняющий слой *под* clear-стеклом поверх яркого медиа |
| `lg-capsule` · `lg-circle` · `lg-r-xs…2xl` · `lg-concentric` | форма (`lg-concentric` читает `--lg-parent-radius` и `--lg-parent-pad`) |
| `lg-interactive` | набухание, свечение из точки касания, «желе» (нужен JS) |
| `lg-lens` | рефракция на T2 (нужен JS, Chromium) |
| `lg-btn` · `lg-icon-btn` | кнопка / круглая кнопка-иконка |
| `lg-group` + `lg-item` | остров тулбара: одна поверхность, плоские элементы |
| `lg-tabbar` + `lg-tab` + `lg-indicator` | таб-бар с каплей-индикатором |
| `lg-seg` + `lg-seg__item` + `lg-indicator` | сегментированный контрол |
| `lg-switch` (+ `__track`, `__thumb`) | переключатель, бегунок-линза при нажатии (без JS) |
| `lg-search` | поле поиска |
| `lg-menu` + `lg-menu__content` + `lg-menu__item` / `__sep` | меню/поповер (морфинг через JS) |
| `lg-sheet` (`data-detent="large"`) | нижняя шторка |
| `lg-scroll-edge lg-scroll-edge--top/--bottom` | scroll edge effect |
| `lg-label-2` | вторичный текст на стекле |

Атрибуты: `data-lg-adaptive` (элемент меняет вид по секции под ним), `data-lg-surface="light|dark|auto"` (на секциях контента), `data-lg-appearance` (принудительный вид), `html[data-lg-tier]` (ставит JS), `html[data-theme]`.

## 5. JS API (`liquid-glass.js`)

| Функция | Что делает |
|---|---|
| `initLiquidGlass({ root, tier = 'auto', guard = true })` | уровень + улучшение всех `.lg-lens`, `.lg-interactive`, `[data-lg-adaptive]` в `root`; следит за настройками доступности; возвращает cleanup |
| `enhance(el, { lens, interactive, bezel, strength, profile, ior, aberration, scale, maxScale })` | улучшить один элемент (для фреймворков); возвращает cleanup |
| `liquidIndicator(track, { indicator, items, selected, onChange, draggable })` | капля-индикатор с перетаскиванием и клавиатурой; `{ select(i), index, destroy() }` |
| `morphOpen(source, panel, { onClose })` | морфинг кнопки в меню/поповер; `{ close() }` |
| `adaptiveAppearance(el)` | светлый/тёмный вид по `data-lg-surface` секции под элементом |
| `detectTier()` · `setTier(n)` · `getTier()` | уровни T0–T3 |
| `fpsGuard({ sampleMs, slowShare, onDowngrade })` | понижение уровня при просадках |
| `Spring`, `springDriver(render)`, `animateSpring(from, to, cfg, onUpdate, onDone)` | прерываемые пружины с сохранением скорости |
| `MOTION` | токены пружин |
| `rubberBand(offset, dimension, c)` | сопротивление при вытягивании за предел |
| `refractionProfile()`, `displacementMap()` | оптика для своих фильтров/канвасов |

## 6. Фреймворки

Модуль SSR-безопасен (всё обращение к `window` — внутри функций). Вызывай `enhance`/`liquidIndicator` только на клиенте после монтирования.

### React / Next.js

```tsx
'use client';
import { useEffect, useRef, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import { adaptiveAppearance, detectTier, enhance, fpsGuard, liquidIndicator, setTier } from '@/lib/liquid-glass/liquid-glass.js';

type Variant = 'regular' | 'clear' | 'thick' | 'tinted' | 'prominent';
type GlassProps<T extends ElementType> = {
  as?: T; variant?: Variant; lens?: boolean; interactive?: boolean;
} & Omit<ComponentPropsWithoutRef<T>, 'as'>;

export function Glass<T extends ElementType = 'div'>({
  as, variant = 'regular', lens = false, interactive = false, className = '', ...rest
}: GlassProps<T>) {
  const Tag: ElementType = as ?? 'div';
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => enhance(ref.current!, { lens, interactive }), [lens, interactive]);
  const cls = ['lg', variant !== 'regular' && `lg-${variant}`, lens && 'lg-lens', interactive && 'lg-interactive', className]
    .filter(Boolean).join(' ');
  return <Tag ref={ref} className={cls} {...rest} />;
}

/** Один раз в корне приложения. */
export function LiquidGlassRoot({ children }: { children: ReactNode }) {
  useEffect(() => { setTier(detectTier()); return fpsGuard(); }, []);
  return <>{children}</>;
}

type Tab = { id: string; label: string; icon: ReactNode };

export function TabBar({ tabs, value, onChange }: { tabs: Tab[]; value: number; onChange(i: number): void }) {
  const ref = useRef<HTMLElement | null>(null);
  const api = useRef<ReturnType<typeof liquidIndicator> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = ref.current!;                       // сам бар — и стекло, и трек индикатора
    const offLens = enhance(el, { lens: true });
    const offAdaptive = adaptiveAppearance(el);
    api.current = liquidIndicator(el, { selected: value, onChange: (i) => onChangeRef.current(i) });
    return () => { api.current?.destroy(); offAdaptive(); offLens(); };
  }, []);
  useEffect(() => { if (api.current && api.current.index !== value) api.current.select(value); }, [value]);

  return (
    <nav ref={ref} className="lg lg-tabbar lg-lens" role="tablist" aria-label="Разделы">
      <span className="lg-indicator" />
      {tabs.map((t) => <button key={t.id} className="lg-tab" role="tab">{t.icon}{t.label}</button>)}
    </nav>
  );
}
```

- Дочерние эффекты выполняются раньше корневого: `enhance` подписывается на смену уровня и включит рефракцию, когда корень выставит T2.
- CSS подключай глобально (`app/layout.tsx` / `_app.tsx`), до Tailwind utilities или вместе с ними.
- Для анимаций раскладки — Motion (`framer-motion`): `transition={{ type: 'spring', stiffness: 438.6, damping: 35.6, mass: 1 }}` (токен snappy), значения — из `tools/spring.mjs`.

### Vue 3 / Nuxt

```ts
// liquid-glass.directive.ts
import type { Directive } from 'vue';
import { enhance } from './liquid-glass.js';

type Opts = { lens?: boolean; interactive?: boolean } | undefined;
const store = new WeakMap<HTMLElement, () => void>();

export const vGlass: Directive<HTMLElement, Opts> = {
  mounted(el, { value }) { store.set(el, enhance(el, value ?? {})); },
  updated(el, { value, oldValue }) {
    if (JSON.stringify(value) === JSON.stringify(oldValue)) return;
    store.get(el)?.(); store.set(el, enhance(el, value ?? {}));
  },
  unmounted(el) { store.get(el)?.(); store.delete(el); },
};
```

```vue
<button v-glass="{ lens: true, interactive: true }" class="lg lg-btn">Готово</button>
```

Nuxt: регистрируй директиву и `setTier(detectTier())` в `plugins/liquid-glass.client.ts`.

### Svelte / SvelteKit

```ts
// glass.ts
import { enhance } from './liquid-glass.js';
export function glass(node: HTMLElement, opts: { lens?: boolean; interactive?: boolean } = {}) {
  let dispose = enhance(node, opts);
  return { update(next: typeof opts) { dispose(); dispose = enhance(node, next); }, destroy() { dispose(); } };
}
```

```svelte
<button use:glass={{ lens: true, interactive: true }} class="lg lg-btn">Готово</button>
```

### Angular

```ts
import { AfterViewInit, Directive, ElementRef, Inject, Input, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { enhance } from './liquid-glass.js';

@Directive({ selector: '[lgGlass]', standalone: true })
export class LiquidGlassDirective implements AfterViewInit, OnDestroy {
  @Input() lgGlass: { lens?: boolean; interactive?: boolean } | '' = '';
  private dispose?: () => void;
  constructor(private el: ElementRef<HTMLElement>, @Inject(PLATFORM_ID) private platformId: object) {}
  ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) this.dispose = enhance(this.el.nativeElement, this.lgGlass || {});
  }
  ngOnDestroy() { this.dispose?.(); }
}
```

```html
<button class="lg lg-btn" [lgGlass]="{ lens: true, interactive: true }">Готово</button>
```

### Tailwind CSS

Эталонные классы работают рядом с утилитами Tailwind — не переписывай стекло на утилиты (псевдоэлементы, маски и `@property` в утилитах нечитаемы).

- **v4:** `@import "tailwindcss"; @import "./liquid-glass.css"; @import "./liquid-glass.tailwind.css";` — адаптер [`liquid-glass.tailwind.css`](../reference/web/liquid-glass.tailwind.css) даёт утилиты на токенах: `rounded-glass-lg`, `ease-lg-snappy`, `text-glass-label`, `blur-glass` и вариант `lg-dark:`.
- **v3:** подключи `liquid-glass.css` в глобальном CSS перед `@tailwind utilities`; при желании пробрось токены в `theme.extend` (`transitionTimingFunction: { 'lg-snappy': 'var(--lg-ease-snappy)' }` и т. п.).

```html
<button class="lg lg-btn lg-interactive lg-lens px-6 ease-lg-snappy">Готово</button>
```

### Web Components / Lit

В `firstUpdated()` вызови `enhance(this.renderRoot.querySelector('.lg'), {...})`, в `disconnectedCallback()` — cleanup. Стили эталона должны быть в том же shadow root (`adoptedStyleSheets`). SVG-фильтры эталон кладёт в `document.body`; ссылки `url(#id)` из shadow DOM разрешаются в пределах своего дерева, поэтому для рефракции в shadow DOM либо перенеси `<defs>` в shadow root, либо оставь таким компонентам T1. Проверь скриншотом, что рефракция действительно применилась.

## 7. Движение в вебе

- **Переходы состояний** (hover, checked, detent): CSS `transition` с `linear()`-пружинами из токенов (`--lg-ease-snappy` + `--lg-dur-snappy` и т. д.).
- **Жесты и прерываемые анимации:** JS-пружины (`Spring`, `springDriver`) — сохраняют скорость, работают на любой частоте кадров.
- **Раскладка** (переупорядочивание, разворачивание): Motion `layout` или FLIP; радиус компенсируй как в `morphOpen()`.
- **Переходы между страницами:** View Transitions API допустим, но снимки статичны — стекло во время перехода не живое. Для меню и поповеров используй `morphOpen()`.
- Анимируй только `transform`/`scale`/`translate`/`opacity`. Никогда — `backdrop-filter`, `width/height` (кроме одного индикатора), `box-shadow` покадрово.

## 8. T3: WebGL

Для фонов, которые ты рисуешь сам (изображение, видео, canvas-сцена, карта, 3D): `createLiquidGlassCanvas(canvas, { drawBackground, shapes, merge, … })` из `liquid-glass-webgl.js`. Даёт настоящее слияние капель (smooth union), аберрацию, блик по нормали. DOM-контент в WebGL не попадает — для обычных страниц остаёмся на T1/T2. Three.js / PixiJS / Babylon: портируй `FRAGMENT_SHADER` в `ShaderMaterial`/`Filter`, фон — render target сцены (размытие — отдельным даунсэмпл-проходом).

## 9. Electron и Tauri

Внутри окна — тот же CSS/JS (это Chromium/WebView). Фон окна — системный материал ОС:
- Electron: `new BrowserWindow({ backgroundMaterial: 'mica' | 'acrylic' | 'tabbed' })` на Windows 11, `vibrancy: 'under-window'` на macOS; для прозрачности body — `background: transparent`.
- Tauri 2: `windowEffects` в конфиге окна или крейт `window-vibrancy` (`apply_mica`, `apply_acrylic`, `apply_vibrancy`), окно `transparent: true`. В Tauri на macOS/Linux движок — WebKit: T1, без SVG-рефракции.

## 10. Проверка

```bash
node tools/visual-check.mjs http://localhost:5173/  # скриншоты: темы × прозрачность/контраст/forced-colors + замер кадров при скролле
```

Плюс ручные проверки из [08-checklist.md](../docs/08-checklist.md). В DevTools: Rendering → Frame Rendering Stats, Performance с CPU ×4 throttling, Layers (число композитных слоёв со стеклом).
