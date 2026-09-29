#!/usr/bin/env node
// Visual + frame check for any web UI built with Liquid Glass.
//
//   node tools/visual-check.mjs <url> [--out shots] [--width 1280] [--height 800] [--dpr 2]
//
// For light/dark × (default, reduced transparency, more contrast, forced colors, reduced motion)
// it saves screenshots (top and mid-page), collects console errors, and measures frame intervals
// during a scripted scroll. Needs Playwright with Chromium:  npm i -D playwright && npx playwright install chromium
// (reduced transparency is emulated through the Chrome DevTools Protocol, so Chromium is required).
//
// Look at the screenshots, not only at the numbers: glass over white ≈ white with shadow + rim,
// over black ≈ dark grey with a bright rim, over colorful content ≈ saturated see-through,
// text readable everywhere; T0 modes must show opaque surfaces with the same silhouettes.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
if (!url) {
  console.log('Usage: node tools/visual-check.mjs <url> [--out shots] [--width 1280] [--height 800] [--dpr 2]');
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

const out = resolve(opt('out', 'shots'));
mkdirSync(out, { recursive: true });
const viewport = { width: Number(opt('width', 1280)), height: Number(opt('height', 800)) };
const deviceScaleFactor = Number(opt('dpr', 1));

const modes = [
  { name: 'default' },
  { name: 'reduced-transparency', features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] },
  { name: 'more-contrast', features: [{ name: 'prefers-contrast', value: 'more' }] },
  { name: 'forced-colors', features: [{ name: 'forced-colors', value: 'active' }] },
  { name: 'reduced-motion', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] },
];

const browser = await chromium.launch();
const report = { url, viewport, runs: [] };

for (const scheme of ['light', 'dark']) {
  for (const mode of modes) {
    const page = await browser.newPage({ viewport, deviceScaleFactor });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme }, ...(mode.features ?? [])],
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    const tag = `${scheme}-${mode.name}`;
    await page.screenshot({ path: join(out, `${tag}-top.png`) });
    const tier = await page.evaluate(() => document.documentElement.dataset.lgTier ?? null);

    let frames = null;
    if (mode.name === 'default') {
      frames = await page.evaluate(
        () =>
          new Promise((done) => {
            const deltas = [];
            let last = 0;
            const start = performance.now();
            const max = document.documentElement.scrollHeight - innerHeight;
            const step = (now) => {
              if (last) deltas.push(now - last);
              last = now;
              const k = (now - start) / 2500;
              scrollTo(0, max * 0.5 * (1 - Math.cos(Math.min(k, 1) * Math.PI)));
              if (k < 1) requestAnimationFrame(step);
              else {
                const s = [...deltas].sort((a, b) => a - b);
                const median = s[Math.floor(s.length / 2)] || 16.7;
                done({
                  frames: deltas.length,
                  medianMs: +median.toFixed(2),
                  p95Ms: +s[Math.floor(s.length * 0.95)]?.toFixed(2),
                  slowShare: +(deltas.filter((d) => d > median * 1.8).length / Math.max(1, deltas.length)).toFixed(3),
                });
              }
            };
            requestAnimationFrame(step);
          }),
      );
    } else {
      await page.evaluate(() => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2));
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${tag}-mid.png`) });
    report.runs.push({ scheme, mode: mode.name, tier, errors, frames });
    await page.close();
  }
}
await browser.close();

writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
for (const r of report.runs) {
  const f = r.frames ? ` frames: median ${r.frames.medianMs}ms, p95 ${r.frames.p95Ms}ms, slow ${(r.frames.slowShare * 100).toFixed(1)}%` : '';
  console.log(`${r.scheme.padEnd(5)} ${r.mode.padEnd(21)} tier=${r.tier ?? '-'}${f}${r.errors.length ? `  ERRORS: ${r.errors.join(' | ')}` : ''}`);
}
console.log(`\nScreenshots and report.json: ${out}\n(headless timing is indicative only: profile on real target devices)`);
