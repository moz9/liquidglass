#!/usr/bin/env node
// Material contract check for a page built with the Liquid Glass reference CSS/JS.
//
//   node tools/material-check.mjs <url> [--width 1280] [--height 860]
//
// Verifies, on real computed styles and real interactions:
//
//   1. the fill alpha of every material variant at the density extremes;
//   2. that the opaque modes (T0, Reduce Transparency, increased contrast, forced colors)
//      are opaque on EVERY surface — the primary action and the pressed switch thumb
//      included — and that nothing samples the backdrop there;
//   3. that the appearance setting reaches every glass element, survives a reload and
//      can be reset to the calibrated default;
//   4. the optics A/B of refraction and scatter (reference demo only);
//   5. that the modal keeps the keyboard focus inside (reference demo only);
//   6. that a narrow viewport has no horizontal overflow.
//
// Needs Playwright with Chromium: npm i -D playwright && npx playwright install chromium
// Exits non-zero when a check fails, so the same command can run in CI.
// Sections that do not exist on the page are reported as skipped, not as failures.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

const browser = await chromium.launch();
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
};

const open = async ({ scheme = 'light', features, viewport = { width, height } } = {}) => {
  const page = await browser.newPage({ viewport, colorScheme: scheme });
  watch(page, 'page');
  if (features) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features });
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  return page;
};

// Read the real alpha of the ::before fill (the last background layer) and the filter chain.
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

const VARIANTS = {
  regular: '.lg.lg-btn:not(.lg-clear):not(.lg-tinted):not(.lg-prominent)',
  clear: '.lg.lg-clear',
  thick: '.lg.lg-thick',
  tinted: '.lg.lg-tinted',
  prominent: '.lg.lg-prominent',
};

// --- 1. the density extremes change the fill of every variant ---------------------
{
  const page = await open();
  const hasDensity = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--lg-density').trim() !== '',
  );
  if (!hasDensity) {
    skip('density changes the material', 'the page does not define --lg-density');
  } else {
    const at = async (d) => {
      await page.evaluate((v) => {
        document.documentElement.style.setProperty('--lg-density', String(v));
      }, d);
      await page.waitForTimeout(500);
      return readMaterial(page, VARIANTS);
    };
    const transparent = await at(0);
    const dense = await at(1);
    for (const name of Object.keys(VARIANTS)) {
      const t = transparent[name];
      const dd = dense[name];
      if (!t || !dd) { skip(`density changes ${name}`, 'variant not found on the page'); continue; }
      // The primary action keeps its alpha on purpose: its label must stay readable.
      const expected = name === 'prominent' ? t.alpha === dd.alpha : t.alpha < dd.alpha;
      check(`density changes ${name}`, expected, `transparent=${t.alpha} dense=${dd.alpha}`);
    }
  }
  await page.close();
}

// --- 2. the opaque modes are opaque everywhere and sample nothing ---------------
for (const [label, features] of [
  ['T0', null],
  ['reduce-transparency', [{ name: 'prefers-reduced-transparency', value: 'reduce' }]],
  ['contrast-more', [{ name: 'prefers-contrast', value: 'more' }]],
  ['forced-colors', [{ name: 'forced-colors', value: 'active' }]],
]) {
  const page = await open({ features });
  if (label === 'T0') {
    await page.evaluate(() => { document.documentElement.dataset.lgTier = '0'; });
    await page.waitForTimeout(600);
  }
  const m = await readMaterial(page, VARIANTS);
  const found = Object.entries(m).filter(([, v]) => v);
  if (!found.length) {
    skip(`opaque mode ${label}`, 'no glass variants on the page');
  } else {
    const notOpaque = found.filter(([, v]) => v.alpha !== 1);
    check(`opaque mode ${label}: every variant has alpha 1`, notOpaque.length === 0,
      notOpaque.map(([n, v]) => `${n}=${v.alpha}`).join(' '));
    const sampling = found.filter(([, v]) => v.backdrop !== 'none' && v.display !== 'none');
    check(`opaque mode ${label}: nothing samples the backdrop`, sampling.length === 0,
      sampling.map(([n, v]) => `${n}="${v.backdrop.slice(0, 28)}"`).join(' '));
  }
  // The pressed switch thumb is a lens of its own: press it for real, then read.
  const thumb = await (async () => {
    const box = await page.evaluate(() => {
      const el = document.querySelector('.lg-switch');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!box) return null;
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.waitForTimeout(300); // the thumb animates into its pressed state
    const state = await page.evaluate(() => {
      const el = document.querySelector('.lg-switch__thumb');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { background: cs.backgroundColor, backdrop: cs.backdropFilter || cs.webkitBackdropFilter || 'none' };
    });
    await page.mouse.up();
    return state;
  })();
  if (thumb) {
    const alphaOf = (bg) => {
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return p.length > 3 ? p[3] : 1;
    };
    const a = alphaOf(thumb.background);
    check(`opaque mode ${label}: the pressed switch thumb does not sample the backdrop`, thumb.backdrop === 'none', `"${thumb.backdrop.slice(0, 28)}"`);
    check(`opaque mode ${label}: the pressed switch thumb is opaque`, a === 1, `alpha=${a} background=${thumb.background}`);
  }
  await page.close();
}

// --- 2b. accessibility wins over a forced quality level -------------------------
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
    const sampling = Object.entries(m).filter(([, v]) => v && v.backdrop !== 'none' && v.display !== 'none');
    check('a forced tier cannot override the system accessibility setting', tier === '0' && sampling.length === 0,
      `tier=${tier} ${sampling.map(([n, v]) => `${n}="${v.backdrop.slice(0, 24)}"`).join(' ')}`);
  }
  await page.close();
}

// --- 3. the appearance setting: global effect, persistence, reset ---------------
{
  const page = await open();
  const hasSlider = await page.evaluate(() => Boolean(document.getElementById('density')));
  if (!hasSlider) {
    skip('appearance setting', 'the page has no #density slider');
  } else {
    const value = await page.evaluate(() => document.getElementById('density').value);
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
    const transparent = await readMaterial(page, VARIANTS);
    await set(100);
    const dense = await readMaterial(page, VARIANTS);
    const moved = Object.entries(transparent).filter(([n, v]) => v && dense[n] && n !== 'prominent' && v.alpha < dense[n].alpha);
    check('the setting reaches several glass elements', moved.length >= 2, `${moved.length} variants changed`);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const restored = await page.evaluate(() => ({
      slider: document.getElementById('density').value,
      css: getComputedStyle(document.documentElement).getPropertyValue('--lg-density').trim(),
    }));
    check('the value survives a reload', restored.slider === '100' && restored.css === '1', JSON.stringify(restored));

    const reset = await page.evaluate(() => {
      const b = document.getElementById('densityReset');
      if (!b) return null;
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
    void value;
  }
  await page.close();
}

// --- 4. the optics A/B (reference demo) -----------------------------------------
{
  const page = await open();
  const hasSeg = await page.evaluate(() => Boolean(document.getElementById('opticsMode')));
  if (!hasSeg) {
    skip('optics A/B', 'the page has no #opticsMode');
  } else {
    const chain = async (index) => {
      await page.locator('#opticsMode .lg-seg__item').nth(index).click();
      await page.waitForTimeout(350);
      return page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('.optics-tile'), '::before');
        return cs.backdropFilter || cs.webkitBackdropFilter || 'none';
      });
    };
    const blurRadius = (c) => {
      const m = c.match(/blur\(([\d.]+)px\)/);
      return m ? Number(m[1]) : null;
    };
    const both = await chain(0);
    const lensOnly = await chain(1);
    const blurOnly = await chain(2);
    check('optics mode 1 = refraction + scatter', both.includes('url(') && blurRadius(both) > 0, both.slice(0, 52));
    check('optics mode 2 = refraction, no scatter', lensOnly.includes('url(') && blurRadius(lensOnly) === 0, lensOnly.slice(0, 52));
    check('optics mode 3 = scatter, no refraction', blurRadius(blurOnly) > 0 && !blurOnly.includes('url('), blurOnly.slice(0, 52));

    // Without a lens the engine falls back to T1: the mode still means what it says.
    // Use the real menu item, so the library's tier really changes.
    await page.click('#moreBtn');
    await page.waitForTimeout(400);
    await page.click('.lg-menu__item[data-tier="1"]');
    await page.waitForTimeout(600);
    await page.locator('#opticsMode .lg-seg__item').nth(1).click(); // "только линза"
    await page.waitForTimeout(350);
    const lensOnlyT1 = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.optics-tile'), '::before');
      return cs.backdropFilter || cs.webkitBackdropFilter || 'none';
    });
    const tierNow = await page.evaluate(() => document.documentElement.dataset.lgTier);
    check('optics mode 2 keeps the scatter off at T1', blurRadius(lensOnlyT1) === 0, `tier=${tierNow} ${lensOnlyT1.slice(0, 46)}`);
    check('the optics tile loses the lens at T1', !lensOnlyT1.includes('url('), lensOnlyT1.slice(0, 46));
  }
  await page.close();
}

// --- 5. the modal keeps the keyboard focus inside (reference demo) --------------
{
  const page = await open();
  const hasDialog = await page.evaluate(() => Boolean(document.getElementById('settings')));
  if (!hasDialog) {
    skip('modal focus', 'the page has no #settings dialog');
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
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const closed = await page.evaluate(() => document.getElementById('settings').hidden);
    check('Escape closes the dialog', closed === true);
  }
  await page.close();
}

// --- 6. no horizontal overflow on narrow viewports ------------------------------
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

await browser.close();

const failed = results.filter((r) => r.ok === false);
const skipped = results.filter((r) => r.ok === null);
writeFileSync(join(out, 'material-check.json'), JSON.stringify({ url, results }, null, 2));
console.log(`\n${results.length - failed.length - skipped.length}/${results.length - skipped.length} checks passed, ${skipped.length} skipped`);
if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
process.exit(failed.length || errors.length ? 1 : 0);
