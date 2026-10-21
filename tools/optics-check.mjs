#!/usr/bin/env node
// Pixel acceptance of reference/web/optics.html, not an Apple similarity score.
// node tools/optics-check.mjs <url-to-optics.html> [--out shots/optics-check]
// Requires Playwright + Chromium. No image-processing dependency: the browser
// decodes its own screenshot PNGs into an isolated canvas for pixel comparison.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from './browser-runtime.mjs';

const args = process.argv.slice(2);
const url = args[0];
if (!url || url.startsWith('--')) {
  console.error('Usage: node tools/optics-check.mjs <url-to-optics.html> [--out shots/optics-check]');
  process.exit(1);
}
const index = args.indexOf('--out');
const out = resolve(index < 0 ? 'shots/optics-check' : args[index + 1]);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [], results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(detail)}`);
};
const decoder = await browser.newPage();
const compare = (a, b) => decoder.evaluate(async ([first, second]) => {
  const decode = async (png) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + png;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return { w: image.width, h: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data };
  };
  const x = await decode(first), y = await decode(second);
  if (x.w !== y.w || x.h !== y.h) throw new Error('Screenshot geometry changed between ablations');
  const margin = Math.ceil(Math.min(x.w, x.h) * .3);
  let edge = 0, core = 0, edgeChanged = 0, coreChanged = 0;
  for (let row = 0; row < x.h; row++) for (let col = 0; col < x.w; col++) {
    const i = (row * x.w + col) * 4;
    const changed = Math.max(...[0, 1, 2, 3].map((k) => Math.abs(x.data[i + k] - y.data[i + k]))) > 8;
    const center = col >= margin && col < x.w - margin && row >= margin && row < x.h - margin;
    if (center) { core++; coreChanged += changed; } else { edge++; edgeChanged += changed; }
  }
  if (!core || !edge) throw new Error('Fixture too small for core/edge comparison');
  return { edgeChanged, edge, coreChanged, core, edgeRatio: edgeChanged / edge, coreRatio: coreChanged / core };
}, [a.toString('base64'), b.toString('base64')]);

try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(e.message));
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    if (!response?.ok()) throw new Error('Optics fixture HTTP load failed');
    await page.locator('#lens').waitFor({ state: 'visible' });
    if (theme === 'dark') await page.click('#theme');
    await page.waitForTimeout(500); // settle the theme and background transition
    const tile = page.locator('#lens');
    const capture = async (name) => tile.screenshot({ path: join(out, `${theme}-${name}.png`) });
    const change = (property, value) => page.evaluate(({ property, value }) => {
      const style = document.querySelector('#lens').style;
      if (value === null) style.removeProperty(property); else style.setProperty(property, value);
    }, { property, value });
    const shift = (value) => page.evaluate((value) => {
      const slider = document.querySelector('#background');
      slider.value = String(value); slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    const sourceTransform = () => page.evaluate(() => getComputedStyle(document.querySelector('.map')).transform);
    // Keep the same SVG pipeline for the identity control. Removing url(...) can
    // change clipping/blur bounds even at zero displacement, producing false proof.
    const displacement = await page.evaluate(() => {
      const filter = getComputedStyle(document.querySelector('#lens'), '::before').backdropFilter;
      const id = filter.match(/url\(["']?#([^"')]+)["']?\)/)?.[1];
      const nodes = id ? [...document.getElementById(id).querySelectorAll('feDisplacementMap')] : [];
      if (!nodes.length) throw new Error('No live displacement filter: this renderer is not proven T2');
      return { id, scales: nodes.map((node) => node.getAttribute('scale')) };
    });
    const setDisplacement = (enabled) => page.evaluate(({ id, scales, enabled }) => {
      document.getElementById(id).querySelectorAll('feDisplacementMap').forEach((node, i) => {
        node.setAttribute('scale', enabled ? scales[i] : '0');
      });
    }, { ...displacement, enabled });
    const on = await capture('lens-on');
    const repeat = await capture('repeat');
    const stability = await compare(on, repeat);
    check(`${theme}: fixed backdrop is stable`, stability.coreRatio < .001 && stability.edgeRatio < .001, stability);
    await setDisplacement(false);
    const off = await capture('lens-off');
    const lens = await compare(on, off);
    check(`${theme}: lens changes the edge`, lens.edgeChanged > 40 && lens.edgeRatio > .004, lens);
    check(`${theme}: lens leaves the measured core unchanged`, lens.coreRatio < .002, lens);
    await change('--lg-blur', '0px');
    const noBlur = await capture('no-blur');
    const blur = await compare(off, noBlur);
    const scatterOff = await page.evaluate(() => getComputedStyle(document.querySelector('#lens'), '::before').backdropFilter.includes('blur(0px)'));
    check(`${theme}: blur changes actual backdrop pixels`, scatterOff && blur.coreRatio > .005, blur);
    await change('--lg-blur', null); await setDisplacement(true);
    const sourceBefore = await sourceTransform();
    await shift(60);
    const sourceMoved = await sourceTransform();
    const moved = await capture('source-moved');
    const live = await compare(on, moved);
    check(`${theme}: moving the source changes glass pixels`, sourceMoved !== sourceBefore && live.coreRatio > .01, live);
    await page.click('#reduce'); await page.waitForTimeout(350);
    const solidState = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#lens'), '::before');
      const rgba = cs.backgroundColor.match(/rgba?\(([^)]+)\)/)?.[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return document.querySelector('#reduce').checked && document.documentElement.dataset.lgTier === '0'
        && cs.backdropFilter === 'none' && rgba && (rgba.length < 4 || rgba[3] === 1);
    });
    const solid = await capture('solid');
    await shift(-60);
    const solidSourceMoved = await sourceTransform();
    const solidMoved = await capture('solid-source-moved');
    const opaque = await compare(solid, solidMoved);
    check(`${theme}: opaque core stops sampling the source`, solidState && solidSourceMoved !== sourceMoved && opaque.coreChanged === 0, opaque);
    await page.close();
  }
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  check('fixture completed', false, String(e));
} finally {
  await browser.close();
}
writeFileSync(join(out, 'optics-check.json'), JSON.stringify({ url, results, errors }, null, 2));
console.log('Pixel differences prove this fixture optics only; compare a real product against its Apple reference separately.');
process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
