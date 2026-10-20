#!/usr/bin/env node
// Material contract check for a page built with the Liquid Glass reference CSS/JS.
//
//   node tools/material-check.mjs <url> [--width 1280] [--height 860] [--out shots]
//
// Verifies, on real computed styles and real interactions:
//
//   1. the dense end of the density setting reproduces the calibrated tokens
//      (tokens/liquid-glass.tokens.json) and the transparent end really changes
//      every material variant, in light and in dark;
//   2. the opaque modes (T0, Reduce Transparency, increased contrast, forced colors)
//      are opaque on EVERY surface — the primary action and the pressed switch
//      thumb included — and nothing samples the backdrop there, the scroll edge
//      included;
//   3. a forced quality level cannot override the system accessibility setting;
//   4. the appearance setting reaches every glass element, survives a reload and
//      returns to the calibrated default on reset;
//   5. the optics A/B of refraction and scatter, in every system mode;
//   6. the modal keeps the keyboard focus inside, restores it on close and blocks
//      the background;
//   7. a narrow viewport has no horizontal overflow.
//
// The last section is a negative control: the known old defects are restored in the
// page and the checks MUST report them, so a green run means the checks have teeth.
//
// Needs Playwright with Chromium: npm i -D playwright && npx playwright install chromium
// Exits non-zero when a check fails, so the same command can run in CI.
// Sections that do not exist on the page are reported as skipped, not as failures.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
if (!url) {
  console.log('Usage: node tools/material-check.mjs <url> [--width 1280] [--height 860]');
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const width = Number(opt('width', 1280));
const height = Number(opt('height', 860));
const out = resolve(opt('out', 'shots'));
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const skip = (name, why) => {
  results.push({ name, ok: null, detail: why });
  console.log(`SKIP  ${name}  — ${why}`);
};

// --- expected values from the tokens, so the dense end is compared, not assumed ---
const alphaOf = (color) => {
  const m = String(color).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return p.length > 3 ? p[3] : 1;
};
let expected = null;
try {
  const tokens = JSON.parse(
    await import('node:fs').then((fs) => fs.readFileSync(join(root, 'tokens/liquid-glass.tokens.json'), 'utf8')),
  );
  const m = tokens.material;
  expected = {
    light: {
      regular: alphaOf(m.regular.fill.light.$value),
      clear: alphaOf(m.clear.fill.light.$value),
      thick: alphaOf(m.thick.fill.light.$value),
      tinted: m.tinted.fillAccentShare.$value,
      prominent: m.prominent.fillAccentShare.$value,
    },
    dark: {
      regular: alphaOf(m.regular.fill.dark.$value),
      clear: alphaOf(m.clear.fill.dark.$value),
      thick: alphaOf(m.thick.fill.dark.$value),
      tinted: m.tinted.fillAccentShare.$value,
      prominent: m.prominent.fillAccentShare.$value,
    },
  };
} catch {
  console.warn('tokens/liquid-glass.tokens.json not readable: the dense end will not be compared with it');
}

const browser = await chromium.launch();
const errors = [];

const open = async ({ scheme = 'light', features, viewport = { width, height } } = {}) => {
  const page = await browser.newPage({ viewport, colorScheme: scheme });
  page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`page: ${m.text()}`));
  if (features) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features });
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  return page;
};

const VARIANTS = {
  regular: '.lg.lg-btn:not(.lg-clear):not(.lg-tinted):not(.lg-prominent)',
  clear: '.lg.lg-clear',
  thick: '.lg.lg-thick',
  tinted: '.lg.lg-tinted',
  prominent: '.lg.lg-prominent',
};
// The same variants, but only those that follow the page theme. An adaptive element
// (data-lg-adaptive) takes the appearance of the section below it, so it must not be
// compared with the light or the dark token.
const TOKEN_VARIANTS = {
  regular: '.lg.lg-btn:not(.lg-clear):not(.lg-tinted):not(.lg-prominent):not([data-lg-adaptive]):not([data-lg-appearance])',
  clear: '.lg.lg-clear:not([data-lg-adaptive]):not([data-lg-appearance])',
  thick: '.lg.lg-thick:not([data-lg-adaptive]):not([data-lg-appearance])',
  tinted: '.lg.lg-tinted:not([data-lg-adaptive]):not([data-lg-appearance])',
  prominent: '.lg.lg-prominent:not([data-lg-adaptive]):not([data-lg-appearance])',
};
// Elements that must follow the appearance setting.
const FOLLOWERS = {
  tabbar: '.lg-tabbar',
  tile: '.optics-tile',
  preview: '.preview__tile',
  button: '.lg.lg-btn:not(.lg-clear):not(.lg-tinted):not(.lg-prominent)',
};

// Read the real fill alpha of ::before (the last background layer) and the filter chain.
const readMaterial = (page, sels) =>
  page.evaluate((selectors) => {
    const alpha = (value) => {
      const rgb = value.match(/rgba?\(([^)]+)\)/);
      if (rgb) {
        const p = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return p.length > 3 ? p[3] : 1;
      }
      const srgb = value.match(/color\(srgb\s+([^)]+)\)/);
      if (srgb) {
        const parts = srgb[1].split('/');
        return parts[1] !== undefined ? Number(parts[1].trim()) : 1;
      }
      return null;
    };
    const out = {};
    for (const [name, sel] of Object.entries(selectors)) {
      const el = document.querySelector(sel);
      if (!el) { out[name] = null; continue; }
      const cs = getComputedStyle(el, '::before');
      const layers = cs.background.split(/,(?![^()]*\))/).map((s) => s.trim());
      out[name] = {
        alpha: alpha(layers[layers.length - 1] ?? ''),
        backdrop: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
        display: cs.display,
      };
    }
    return out;
  }, sels);

const readEdge = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.lg-scroll-edge');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { backdrop: cs.backdropFilter || cs.webkitBackdropFilter || 'none' };
  });

// Press the switch for real: scroll it into view, confirm :active, then read the thumb.
const pressThumb = async (page) => {
  const has = await page.evaluate(() => {
    const el = document.querySelector('.lg-switch');
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    return true;
  });
  if (!has) return null;
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => {
    const r = document.querySelector('.lg-switch').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, inViewport: r.top >= 0 && r.bottom <= innerHeight };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(320);
  const state = await page.evaluate(() => {
    const input = document.querySelector('.lg-switch input');
    const thumb = document.querySelector('.lg-switch__thumb');
    if (!thumb) return null;
    const cs = getComputedStyle(thumb);
    return {
      active: input ? input.matches(':active') : false,
      background: cs.backgroundColor,
      backdrop: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
    };
  });
  await page.mouse.up();
  return { ...state, inViewport: box.inViewport };
};

const readOpticsChain = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.optics-tile');
    if (!el) return null;
    const cs = getComputedStyle(el, '::before');
    return cs.backdropFilter || cs.webkitBackdropFilter || 'none';
  });

// Remove rules from the live CSSOM — used by the negative controls.
// Grouping rules (@media) hold the rules we need, so the scan goes inside them.
const removeRules = (page, needles) =>
  page.evaluate((list) => {
    let removed = 0;
    const matches = (rule) => rule.selectorText && list.some((n) => rule.selectorText.includes(n));
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i];
        if (matches(rule)) { sheet.deleteRule(i); removed++; continue; }
        if (rule.cssRules) {
          for (let j = rule.cssRules.length - 1; j >= 0; j--) {
            if (matches(rule.cssRules[j])) { rule.deleteRule(j); removed++; }
          }
        }
      }
    }
    return removed;
  }, needles);

const injectCss = (page, css) =>
  page.evaluate((text) => {
    const style = document.createElement('style');
    style.textContent = text;
    document.head.appendChild(style);
    return true;
  }, css);

const blurRadius = (chain) => {
  const m = chain.match(/blur\(([\d.]+)px\)/);
  return m ? Number(m[1]) : null;
};
const samples = (chain) => chain !== 'none' && !chain.includes('display');

// The predicates the checks are built on. The negative controls reuse them, so the
// old defect has to make the very same check that passes on the fixed build fail.
const thumbIsOpaque = (t) => !!t && t.active === true && alphaOf(t.background) === 1 && !samples(t.backdrop);
const edgeIsSilent = (e) => !!e && !samples(e.backdrop);
const tileIsSilent = (c) => !!c && !samples(c);

// --- 1. the density ends: transparent changes every variant, dense matches tokens ---
for (const scheme of ['light', 'dark']) {
  const page = await open({ scheme });
  const hasDensity = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--lg-density').trim() !== '',
  );
  if (!hasDensity) {
    skip(`density ends (${scheme})`, 'the page does not define --lg-density');
  } else {
    const at = async (d) => {
      await page.evaluate((v) => { document.documentElement.style.setProperty('--lg-density', String(v)); }, d);
      await page.waitForTimeout(500);
      return readMaterial(page, VARIANTS);
    };
    const transparent = await at(0);
    const dense = await at(1);
    for (const name of Object.keys(VARIANTS)) {
      const t = transparent[name];
      const dd = dense[name];
      if (!t || !dd) { skip(`density changes ${name} (${scheme})`, 'variant not found on the page'); continue; }
      // The primary action keeps its alpha on purpose: its label must stay readable.
      const ok = name === 'prominent' ? t.alpha === dd.alpha : t.alpha < dd.alpha;
      check(`density changes ${name} (${scheme})`, ok, `transparent=${t.alpha} dense=${dd.alpha}`);
    }
    if (expected) {
      const byTheme = await readMaterial(page, TOKEN_VARIANTS);
      for (const name of Object.keys(TOKEN_VARIANTS)) {
        const dd = byTheme[name];
        if (!dd) { skip(`the dense end matches the token for ${name} (${scheme})`, 'variant not found on the page'); continue; }
        const want = expected[scheme][name];
        check(`the dense end matches the token for ${name} (${scheme})`, Math.abs(dd.alpha - want) < 0.005,
          `measured=${dd.alpha} token=${want}`);
      }
    } else {
      skip('the dense end matches the tokens', 'the token file is not readable');
    }
  }
  await page.close();
}

// --- 2. the opaque modes are opaque everywhere and sample nothing ----------------
for (const scheme of ['light', 'dark']) {
  for (const [label, features] of [
    ['T0', null],
    ['reduce-transparency', [{ name: 'prefers-reduced-transparency', value: 'reduce' }]],
    ['contrast-more', [{ name: 'prefers-contrast', value: 'more' }]],
    ['forced-colors', [{ name: 'forced-colors', value: 'active' }]],
  ]) {
    const page = await open({ scheme, features });
    if (label === 'T0') {
      await page.evaluate(() => { document.documentElement.dataset.lgTier = '0'; });
      await page.waitForTimeout(600);
    }
    const m = await readMaterial(page, VARIANTS);
    const found = Object.entries(m).filter(([, v]) => v);
    if (!found.length) {
      skip(`opaque mode ${label} (${scheme})`, 'no glass variants on the page');
    } else {
      const notOpaque = found.filter(([, v]) => v.alpha !== 1);
      check(`opaque mode ${label} (${scheme}): every variant has alpha 1`, notOpaque.length === 0,
        notOpaque.map(([n, v]) => `${n}=${v.alpha}`).join(' '));
      const sampling = found.filter(([, v]) => samples(v.backdrop) && v.display !== 'none');
      check(`opaque mode ${label} (${scheme}): nothing samples the backdrop`, sampling.length === 0,
        sampling.map(([n, v]) => `${n}="${v.backdrop.slice(0, 28)}"`).join(' '));
    }
    // The scroll edge samples the backdrop on its own.
    const edge = await readEdge(page);
    if (edge) {
      check(`opaque mode ${label} (${scheme}): the scroll edge does not sample the backdrop`, edgeIsSilent(edge), `"${edge.backdrop.slice(0, 28)}"`);
    }
    // The pressed switch thumb is a lens of its own.
    const thumb = await pressThumb(page);
    if (thumb) {
      if (!thumb.active) {
        check(`opaque mode ${label} (${scheme}): the press was real`, false, 'the switch never got :active');
      } else {
        check(`opaque mode ${label} (${scheme}): the pressed thumb is opaque and samples nothing`, thumbIsOpaque(thumb),
          `alpha=${alphaOf(thumb.background)} backdrop="${thumb.backdrop.slice(0, 28)}"`);
      }
    }
    await page.close();
  }
}

// --- 3. a forced level cannot override the system accessibility setting ----------
{
  const page = await open({ features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  const hasMenu = await page.evaluate(() => Boolean(document.querySelector('.lg-menu__item[data-tier="2"]')));
  if (!hasMenu) {
    skip('a forced tier cannot override the system accessibility setting', 'the page has no tier menu');
  } else {
    await page.click('#moreBtn');
    await page.waitForTimeout(400);
    await page.click('.lg-menu__item[data-tier="2"]');
    await page.waitForTimeout(700);
    const tier = await page.evaluate(() => document.documentElement.dataset.lgTier);
    const m = await readMaterial(page, VARIANTS);
    const sampling = Object.entries(m).filter(([, v]) => v && samples(v.backdrop) && v.display !== 'none');
    check('a forced tier cannot override the system accessibility setting', tier === '0' && sampling.length === 0,
      `tier=${tier} ${sampling.map(([n, v]) => `${n}="${v.backdrop.slice(0, 24)}"`).join(' ')}`);
  }
  await page.close();
}

// --- 4. the appearance setting reaches every element and survives a reload -------
{
  const page = await open();
  const hasSlider = await page.evaluate(() => Boolean(document.getElementById('density')));
  if (!hasSlider) {
    skip('the appearance setting', 'the page has no #density slider');
  } else {
    const set = async (v) => {
      await page.evaluate((val) => {
        const d = document.getElementById('density');
        d.value = String(val);
        d.dispatchEvent(new Event('input', { bubbles: true }));
        d.dispatchEvent(new Event('change', { bubbles: true }));
      }, v);
      await page.waitForTimeout(400);
    };
    await set(0);
    const transparent = await readMaterial(page, FOLLOWERS);
    await set(100);
    const dense = await readMaterial(page, FOLLOWERS);
    for (const [name, t] of Object.entries(transparent)) {
      const dd = dense[name];
      if (!t || !dd) { skip(`the setting reaches ${name}`, 'element not found on the page'); continue; }
      check(`the setting reaches ${name}`, t.alpha < dd.alpha, `transparent=${t.alpha} dense=${dd.alpha}`);
    }

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const restored = await page.evaluate(() => ({
      slider: document.getElementById('density').value,
      css: getComputedStyle(document.documentElement).getPropertyValue('--lg-density').trim(),
    }));
    check('the value survives a reload', restored.slider === '100' && restored.css === '1', JSON.stringify(restored));

    const reset = await page.evaluate(() => {
      const b = document.getElementById('densityReset');
      if (!b) return false;
      b.click();
      return true;
    });
    if (reset) {
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => ({
        slider: document.getElementById('density').value,
        css: getComputedStyle(document.documentElement).getPropertyValue('--lg-density').trim(),
      }));
      check('reset returns the calibrated default', after.slider === '50' && after.css === '0.5', JSON.stringify(after));
    } else {
      skip('reset returns the calibrated default', 'the page has no #densityReset');
    }
  }
  await page.close();
}

// --- 5. the optics A/B, in the normal mode and in every system mode -------------
for (const [label, features] of [
  ['normal', null],
  ['reduce-transparency', [{ name: 'prefers-reduced-transparency', value: 'reduce' }]],
  ['contrast-more', [{ name: 'prefers-contrast', value: 'more' }]],
  ['forced-colors', [{ name: 'forced-colors', value: 'active' }]],
]) {
  const page = await open({ features });
  const hasSeg = await page.evaluate(() => Boolean(document.getElementById('opticsMode')));
  if (!hasSeg) {
    skip(`the optics A/B (${label})`, 'the page has no #opticsMode');
    await page.close();
    continue;
  }
  const chain = async (index) => {
    await page.locator('#opticsMode .lg-seg__item').nth(index).click();
    await page.waitForTimeout(350);
    return readOpticsChain(page);
  };
  const both = await chain(0);
  const lensOnly = await chain(1);
  const blurOnly = await chain(2);
  if (label === 'normal') {
    check('optics mode 1 = refraction + scatter', both.includes('url(') && blurRadius(both) > 0, both.slice(0, 52));
    check('optics mode 2 = refraction, no scatter', lensOnly.includes('url(') && blurRadius(lensOnly) === 0, lensOnly.slice(0, 52));
    check('optics mode 3 = scatter, no refraction', blurRadius(blurOnly) > 0 && !blurOnly.includes('url('), blurOnly.slice(0, 52));
    // Without a lens the engine falls back to T1: the mode still means what it says.
    await page.click('#moreBtn');
    await page.waitForTimeout(400);
    await page.click('.lg-menu__item[data-tier="1"]');
    await page.waitForTimeout(600);
    await page.locator('#opticsMode .lg-seg__item').nth(1).click();
    await page.waitForTimeout(350);
    const atT1 = await readOpticsChain(page);
    const tierNow = await page.evaluate(() => document.documentElement.dataset.lgTier);
    check('optics mode 2 keeps the scatter off at T1', blurRadius(atT1) === 0, `tier=${tierNow} ${atT1.slice(0, 46)}`);
    check('the optics tile loses the lens at T1', !atT1.includes('url('), atT1.slice(0, 46));
  } else {
    for (const [i, name] of ['refraction + scatter', 'refraction, no scatter', 'scatter, no refraction'].entries()) {
      const c = [both, lensOnly, blurOnly][i];
      check(`optics mode "${name}" samples nothing in ${label}`, tileIsSilent(c), `"${c.slice(0, 46)}"`);
    }
  }
  await page.close();
}

// --- 6. the modal keeps the keyboard focus inside --------------------------------
{
  const page = await open();
  const hasDialog = await page.evaluate(() => Boolean(document.getElementById('settings')));
  if (!hasDialog) {
    skip('the modal focus', 'the page has no #settings dialog');
  } else {
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    const where = () => page.evaluate(() => {
      const d = document.getElementById('settings');
      return d.contains(document.activeElement) ? 'in' : `OUT:${document.activeElement?.id || document.activeElement?.tagName || '?'}`;
    });
    const seq = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(90);
      seq.push(await where());
    }
    check('Tab stays inside the dialog', seq.every((s) => s === 'in'), seq.join(','));
    await page.evaluate(() => document.querySelector('#settings button:not([disabled])')?.focus());
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(150);
    check('Shift+Tab wraps inside the dialog', (await where()) === 'in');
    const inert = await page.evaluate(() => document.querySelector('main')?.inert === true);
    check('the background is inert while the dialog is open', inert);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const closed = await page.evaluate(() => document.getElementById('settings').hidden);
    check('Escape closes the dialog', closed === true);
    const restored = await page.evaluate(() => document.activeElement?.id);
    check('the focus returns to the trigger', restored === 'settingsBtn', `activeElement=${restored}`);
  }
  await page.close();
}

// --- 6b. a disabled slider: the focus must land on a usable control ---------------
{
  const page = await open({ features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  const hasDialog = await page.evaluate(() => Boolean(document.getElementById('settings')));
  if (!hasDialog) {
    skip('the modal focus with a disabled slider', 'the page has no #settings dialog');
  } else {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const d = document.getElementById('settings');
      const slider = document.getElementById('density');
      return {
        disabled: slider?.disabled === true,
        focusInside: d.contains(document.activeElement),
        focusId: document.activeElement?.id,
      };
    });
    check('the slider is locked when the system asks for an opaque material', state.disabled);
    check('the focus lands on a usable control', state.focusInside, `activeElement=${state.focusId}`);
  }
  await page.close();
}

// --- 7. no horizontal overflow on narrow viewports ------------------------------
for (const w of [390, 360, 320]) {
  const page = await open({ viewport: { width: w, height: 844 } });
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, wide };
  });
  check(`no horizontal overflow at ${w}px`, m.scrollWidth <= m.clientWidth,
    `scrollWidth=${m.scrollWidth} clientWidth=${m.clientWidth} ${m.wide.join(' ')}`);
  await page.close();
}

// --- 8. negative controls: the old defects must make the same checks FAIL -------
// A green run only means something if the checks fail on the broken variants.
{
  // N1: the pressed thumb under increased contrast, with the opaque-mode rule removed.
  const page = await open({ features: [{ name: 'prefers-contrast', value: 'more' }] });
  const removed = await removeRules(page, [':root .lg-switch input:active']);
  if (!removed) {
    skip('negative control: the pressed thumb', 'no :root .lg-switch input:active rule to remove');
  } else {
    const thumb = await pressThumb(page);
    check('negative control: the old thumb defect makes the check fail', !thumbIsOpaque(thumb),
      `removed=${removed} active=${thumb?.active} alpha=${alphaOf(thumb?.background)} backdrop=${thumb?.backdrop}`);
  }
  await page.close();

  // N2: the scroll edge under increased contrast, with the opaque-mode rule removed.
  const page2 = await open({ features: [{ name: 'prefers-contrast', value: 'more' }] });
  const removed2 = await removeRules(page2, [':root .lg-scroll-edge']);
  if (!removed2) {
    skip('negative control: the scroll edge', 'no :root .lg-scroll-edge rule to remove');
  } else {
    const edge = await readEdge(page2);
    check('negative control: the old scroll-edge defect makes the check fail', !edgeIsSilent(edge),
      `removed=${removed2} backdrop=${edge?.backdrop}`);
  }
  await page2.close();

  // N3: the old A/B override, which re-enabled a backdrop the system had switched off.
  const page3 = await open({ features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  const hasSeg = await page3.evaluate(() => Boolean(document.getElementById('opticsMode')));
  if (!hasSeg) {
    skip('negative control: the A/B override', 'the page has no #opticsMode');
  } else {
    await injectCss(page3, '.optics-stage[data-mode="blur"] .optics-tile::before { backdrop-filter: blur(10px) saturate(1.8) brightness(1.05); }');
    await page3.locator('#opticsMode .lg-seg__item').nth(2).click();
    await page3.waitForTimeout(400);
    const chain = await readOpticsChain(page3);
    check('negative control: the old A/B override makes the check fail', !tileIsSilent(chain), `"${chain.slice(0, 46)}"`);
  }
  await page3.close();
}

await browser.close();

const failed = results.filter((r) => r.ok === false);
const skipped = results.filter((r) => r.ok === null);
writeFileSync(join(out, 'material-check.json'), JSON.stringify({ url, results }, null, 2));
console.log(`\n${results.length - failed.length - skipped.length}/${results.length - skipped.length} checks passed, ${skipped.length} skipped`);
if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
process.exit(failed.length || errors.length ? 1 : 0);
