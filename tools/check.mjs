#!/usr/bin/env node
// Consistency check for this repository. Run after ANY edit:
//
//   node tools/check.mjs          # verify
//   node tools/check.mjs --write  # regenerate derived files (CSS spring easings, GLSL copy), then verify
//
// Verifies that tokens JSON, tools/spring.mjs, reference/web/liquid-glass.{js,css} and the shader
// copies agree, and that every relative link (and #anchor) in Markdown resolves.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOTION_TOKENS, springParams, settleTime, cssLinear } from './spring.mjs';
import { MOTION } from '../reference/web/liquid-glass.js';
import { FRAGMENT_SHADER } from '../reference/web/liquid-glass-webgl.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const errors = [];
const fail = (msg) => errors.push(msg);
const read = (p) => readFileSync(join(root, p), 'utf8');
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// --- derived files ----------------------------------------------------------
const CSS = 'reference/web/liquid-glass.css';
const GLSL = 'reference/shaders/liquid-glass.frag.glsl';
const GLSL_HEADER = '// GENERATED from reference/web/liquid-glass-webgl.js (FRAGMENT_SHADER) by `node tools/check.mjs --write`. Do not edit.\n';

if (write) {
  let css = read(CSS);
  for (const [name, spring] of Object.entries(MOTION_TOKENS)) {
    const { duration, easing } = cssLinear(spring);
    css = css.replace(new RegExp(`--lg-ease-${name}: linear\\([^)]*\\);`), `--lg-ease-${name}: ${easing};`);
    css = css.replace(new RegExp(`--lg-dur-${name}: \\d+ms;`), `--lg-dur-${name}: ${duration}ms;`);
  }
  writeFileSync(join(root, CSS), css);
  writeFileSync(join(root, GLSL), GLSL_HEADER + FRAGMENT_SHADER);
}

// --- motion: tokens JSON == spring.mjs == liquid-glass.js == CSS -------------
const tokens = JSON.parse(read('tokens/liquid-glass.tokens.json'));
const css = read(CSS);
for (const [name, spring] of Object.entries(MOTION_TOKENS)) {
  const t = tokens.motion[name];
  if (!t) { fail(`tokens.motion.${name} is missing`); continue; }
  const p = springParams(spring);
  if (t.response.$value !== spring.response || t.dampingRatio.$value !== spring.dampingRatio)
    fail(`motion.${name}: tokens JSON (${t.response.$value}/${t.dampingRatio.$value}) != tools/spring.mjs (${spring.response}/${spring.dampingRatio})`);
  if (!near(t.stiffness.$value, p.stiffness, 0.06)) fail(`motion.${name}.stiffness ${t.stiffness.$value} != ${p.stiffness.toFixed(1)}`);
  if (!near(t.damping.$value, p.damping, 0.006)) fail(`motion.${name}.damping ${t.damping.$value} != ${p.damping.toFixed(2)}`);
  if (!near(t.settleMs.$value, settleTime(spring) * 1000, 1)) fail(`motion.${name}.settleMs ${t.settleMs.$value} != ${Math.round(settleTime(spring) * 1000)}`);
  const js = MOTION[name];
  if (!js || js.response !== spring.response || js.dampingRatio !== spring.dampingRatio)
    fail(`motion.${name}: reference/web/liquid-glass.js MOTION differs from tools/spring.mjs`);
  const { duration, easing } = cssLinear(spring);
  if (!css.includes(`--lg-ease-${name}: ${easing};`)) fail(`CSS --lg-ease-${name} is stale (run: node tools/check.mjs --write)`);
  if (!css.includes(`--lg-dur-${name}: ${duration}ms;`)) fail(`CSS --lg-dur-${name} is stale (run: node tools/check.mjs --write)`);
}
for (const name of ['lead', 'trail', 'dismiss']) {
  const t = tokens.motion[name];
  const js = MOTION[name];
  if (!t || !js || t.response.$value !== js.response || t.dampingRatio.$value !== js.dampingRatio)
    fail(`motion.${name}: tokens JSON and liquid-glass.js MOTION differ`);
}

// --- material: tokens JSON == CSS custom properties ---------------------------
const normColor = (s) => s.replace(/\s+/g, ' ').replace(/(\d*\.\d+|\d+)/g, (n) => String(Number(n))).trim();
function cssBlock(selectorStart) {
  const i = css.indexOf(selectorStart);
  if (i < 0) return '';
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
}
const lightBlock = cssBlock(':root,\n[data-lg-appearance="light"]');
const darkBlock = cssBlock(':root[data-theme="dark"],\n[data-lg-appearance="dark"]');
const cssVar = (block, name) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
const materialPairs = [
  ['--lgv-fill-regular', tokens.material.regular.fill],
  ['--lgv-fill-clear', tokens.material.clear.fill],
  ['--lgv-fill-thick', tokens.material.thick.fill],
  ['--lgv-solid', tokens.material.solid.fill],
  ['--lgv-label', tokens.color.label],
  ['--lgv-label-2', tokens.color.secondaryLabel],
  ['--lgv-indicator', tokens.color.indicator],
  ['--lgv-hover', tokens.color.hover],
  ['--lgv-glow', tokens.specular.touchGlow],
];
for (const [name, tok] of materialPairs) {
  for (const [mode, block] of [['light', lightBlock], ['dark', darkBlock]]) {
    const v = cssVar(block, name);
    if (!v) fail(`CSS ${mode} block lacks ${name}`);
    else if (normColor(v) !== normColor(tok[mode].$value)) fail(`CSS ${mode} ${name} = ${v} but tokens say ${tok[mode].$value}`);
  }
}
const blurOf = (selector) => css.match(new RegExp(`\\n${selector.replace('.', '\\.')} \\{[^}]*--lg-blur:\\s*(\\d+)px`))?.[1];
for (const [sel, tok] of [['.lg', tokens.material.regular.blur], ['.lg-clear', tokens.material.clear.blur], ['.lg-thick', tokens.material.thick.blur]]) {
  if (`${blurOf(sel)}px` !== tok.$value) fail(`CSS ${sel} --lg-blur = ${blurOf(sel)}px but tokens say ${tok.$value}`);
}

// --- shader copy -----------------------------------------------------------------
if (!existsSync(join(root, GLSL)) || read(GLSL) !== GLSL_HEADER + FRAGMENT_SHADER)
  fail(`${GLSL} is out of sync with FRAGMENT_SHADER (run: node tools/check.mjs --write)`);

// --- Markdown links and anchors ----------------------------------------------------
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === '.git' || f === 'node_modules' || f.startsWith('.tmp')) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.md') || p.endsWith('.mdc')) out.push(p);
  }
  return out;
}
// GitHub heading slug: lowercase, drop punctuation (keep letters/digits/space/-/_), spaces -> '-'
const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
function anchorsOf(file) {
  const seen = new Map();
  const anchors = new Set();
  let inFence = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    if (inFence) continue;
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (!m) continue;
    const base = slug(m[1].replace(/`/g, ''));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n ? `${base}-${n}` : base);
  }
  return anchors;
}
for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, anchor] = target.split('#');
    const abs = path ? resolve(dirname(file), decodeURI(path)) : file;
    if (!existsSync(abs)) { fail(`${relative(root, file)}: broken link ${target}`); continue; }
    if (anchor && abs.endsWith('.md') && !anchorsOf(abs).has(decodeURIComponent(anchor)))
      fail(`${relative(root, file)}: missing anchor #${anchor} in ${relative(root, abs)}`);
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log('✓ tokens, CSS, JS, shaders and links are consistent');
