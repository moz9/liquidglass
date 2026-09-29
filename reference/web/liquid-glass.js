/*
 * Liquid Glass — reference runtime for the web (ES module, zero dependencies).
 *
 *   import { initLiquidGlass } from './liquid-glass.js';
 *   initLiquidGlass();          // detects the tier, enhances .lg-lens / .lg-interactive / [data-lg-adaptive]
 *
 * Tiers (html[data-lg-tier]):
 *   0 solid      — no transparency (Reduce Transparency, forced colors, no backdrop-filter)
 *   1 frosted    — blur + saturation + tint + rim (default CSS; Safari, Firefox, weak devices)
 *   2 lens       — + edge refraction through an SVG displacement map (Chromium only)
 *   3 liquid     — + WebGL shader glass (opt-in, see liquid-glass-webgl.js)
 *
 * Every animation is a spring (see docs/05-motion.md). Motion is transform/opacity only.
 */

// ---------------------------------------------------------------------------
// Motion tokens (response in seconds, SwiftUI semantics). Keep in sync with tokens/.
// ---------------------------------------------------------------------------
export const MOTION = {
  interactive: { response: 0.15, dampingRatio: 0.86 },
  press: { response: 0.22, dampingRatio: 0.65 },
  release: { response: 0.38, dampingRatio: 0.55 },
  snappy: { response: 0.3, dampingRatio: 0.85 },
  morph: { response: 0.42, dampingRatio: 0.78 },
  bouncy: { response: 0.5, dampingRatio: 0.7 },
  smooth: { response: 0.5, dampingRatio: 1 },
  // selection indicator: the leading edge runs ahead, the trailing edge catches up
  lead: { response: 0.24, dampingRatio: 0.8 },
  trail: { response: 0.42, dampingRatio: 0.74 },
  dismiss: { response: 0.28, dampingRatio: 1 },
};

const hasWindow = typeof window !== 'undefined';
const mq = (q) => hasWindow && typeof matchMedia === 'function' && matchMedia(q).matches;
export const prefersReducedMotion = () => mq('(prefers-reduced-motion: reduce)');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Spring (semi-implicit Euler, fixed 1/240 s sub-steps: stable, interruptible,
// keeps velocity when the target changes mid-flight).
// ---------------------------------------------------------------------------
export class Spring {
  constructor(value = 0, config = MOTION.snappy) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.precision = 1e-3;
    this.configure(config);
  }
  configure({ response, dampingRatio }) {
    const omega = (2 * Math.PI) / response;
    this.stiffness = omega * omega;
    this.damping = 2 * dampingRatio * omega;
    return this;
  }
  set(value) {
    this.value = this.target = value;
    this.velocity = 0;
    return this;
  }
  step(dt) {
    let remaining = Math.min(dt, 0.064);
    while (remaining > 0) {
      const h = Math.min(remaining, 1 / 240);
      const accel = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
    if (this.atRest) this.set(this.target);
    return this.value;
  }
  get atRest() {
    return Math.abs(this.value - this.target) < this.precision && Math.abs(this.velocity) < this.precision * 10;
  }
}

/** Runs springs on requestAnimationFrame until all of them settle, calling render() each frame. */
export function springDriver(render) {
  const springs = new Set();
  let raf = 0;
  let last = 0;
  const tick = (now) => {
    const dt = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    let active = false;
    for (const s of springs) {
      s.step(dt);
      if (!s.atRest) active = true;
    }
    render();
    if (active) raf = requestAnimationFrame(tick);
    else raf = last = 0;
  };
  return {
    add: (...list) => list.forEach((s) => springs.add(s)),
    kick: () => {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    },
    stop: () => {
      cancelAnimationFrame(raf);
      raf = last = 0;
    },
  };
}

/** Animate one number with a spring. Returns { retarget(to), stop() }. */
export function animateSpring(from, to, config, onUpdate, onDone) {
  const s = new Spring(from, config);
  s.target = to;
  const drv = springDriver(() => {
    onUpdate(s.value, s.velocity);
    if (s.atRest) onDone?.();
  });
  drv.add(s);
  drv.kick();
  return {
    retarget(next) {
      s.target = next;
      drv.kick();
    },
    stop: drv.stop,
  };
}

// ---------------------------------------------------------------------------
// Tier detection
// ---------------------------------------------------------------------------
export function isChromium() {
  if (!hasWindow) return false;
  const brands = navigator.userAgentData?.brands;
  if (brands) return brands.some((b) => /Chromium/i.test(b.brand));
  // insecure contexts have no userAgentData; iOS Chrome ("CriOS") is WebKit and does not match
  return /\bChrom(e|ium)\/\d/.test(navigator.userAgent) && !/\b(Firefox|FxiOS)\//.test(navigator.userAgent);
}

export function detectTier() {
  if (!hasWindow) return 1;
  if (mq('(forced-colors: active)') || mq('(prefers-reduced-transparency: reduce)')) return 0;
  const backdrop = CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
  if (!backdrop) return 0;
  const memory = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (navigator.connection?.saveData || memory <= 2 || cores <= 2) return 1;
  if (!isChromium()) return 1; // SVG filters in backdrop-filter are Chromium-only
  if (mq('(pointer: coarse)') && (memory <= 4 || cores <= 4)) return 1;
  return 2;
}

let tier = 1;
const tierListeners = new Set();
export const getTier = () => tier;
export function setTier(next) {
  tier = clamp(Math.round(next), 0, 3);
  if (hasWindow) document.documentElement.dataset.lgTier = String(tier);
  tierListeners.forEach((fn) => fn(tier));
}
const onTierChange = (fn) => {
  tierListeners.add(fn);
  return () => tierListeners.delete(fn);
};

// ---------------------------------------------------------------------------
// Optics: displacement profile (docs/03-optics.md)
// ---------------------------------------------------------------------------
const profileHeight = (t, p) => Math.pow(1 - Math.pow(1 - t, p), 1 / p);

/**
 * Lateral displacement across the bezel, normalized to 1 at the outer edge.
 * t = 0 at the edge, 1 where the flat core begins. Snell's law on a convex surface
 * h(t) = (1 - (1 - t)^p)^(1/p): p = 2 circle, p = 4 squircle (flatter core, sharper edge).
 */
export function refractionProfile({ ior = 1.5, profile = 3, samples = 128 } = {}) {
  const lut = new Float32Array(samples);
  const edge = Math.tan(Math.PI / 2 - Math.asin(1 / ior));
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    let theta = Math.PI / 2;
    if (t > 0) {
      const a = Math.max(0, t - 1e-3);
      const b = Math.min(1, t + 1e-3);
      theta = Math.atan((profileHeight(b, profile) - profileHeight(a, profile)) / (b - a));
    }
    const thetaT = Math.asin(Math.sin(theta) / ior);
    lut[i] = Math.tan(theta - thetaT) / edge;
  }
  return lut;
}

function sdRoundRect(px, py, hw, hh, r) {
  const qx = Math.abs(px) - hw + r;
  const qy = Math.abs(py) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

/**
 * Displacement map for feDisplacementMap: R = x offset, G = y offset, 0.5 = none.
 * The sample offset points INWARD (a convex bezel bends rays toward the center).
 */
export function displacementMap(width, height, radius, bezel, lut) {
  const W = Math.max(1, Math.round(width));
  const H = Math.max(1, Math.round(height));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const data = img.data;
  const hw = W / 2;
  const hh = H / 2;
  const n = lut.length - 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const px = x + 0.5 - hw;
      const py = y + 0.5 - hh;
      const d = sdRoundRect(px, py, hw, hh, radius);
      let dx = 0;
      let dy = 0;
      if (d < 0 && d > -bezel) {
        const mag = lut[Math.round((-d / bezel) * n)];
        let nx = sdRoundRect(px + 0.5, py, hw, hh, radius) - sdRoundRect(px - 0.5, py, hw, hh, radius);
        let ny = sdRoundRect(px, py + 0.5, hw, hh, radius) - sdRoundRect(px, py - 0.5, hw, hh, radius);
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        dx = -nx * mag;
        dy = -ny * mag;
      }
      data[i] = Math.round((0.5 + dx * 0.5) * 255);
      data[i + 1] = Math.round((0.5 + dy * 0.5) * 255);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// Refraction (tier 2): one cached SVG filter per (size, radius, optics)
// ---------------------------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_FILTERS = 48;
const filters = new Map(); // key -> { id, node }
const luts = new Map();
let defs = null;
let filterSeq = 0;

function ensureDefs() {
  if (defs?.isConnected) return defs;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  defs = document.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

function getFilter(w, h, r, o) {
  const key = [w, h, r, o.bezel, o.strength, o.aberration, o.profile, o.ior].join('|');
  const hit = filters.get(key);
  if (hit) {
    filters.delete(key); // LRU refresh
    filters.set(key, hit);
    return hit.id;
  }
  const lutKey = `${o.ior}|${o.profile}`;
  if (!luts.has(lutKey)) luts.set(lutKey, refractionProfile({ ior: o.ior, profile: o.profile }));
  const href = displacementMap(w, h, r, o.bezel, luts.get(lutKey));
  const id = `lg-refract-${++filterSeq}`;
  const scale = (2 * o.strength).toFixed(2);
  const node = document.createElementNS(SVG_NS, 'filter');
  node.setAttribute('id', id);
  node.setAttribute('x', '0');
  node.setAttribute('y', '0');
  node.setAttribute('width', '100%');
  node.setAttribute('height', '100%');
  // sRGB is mandatory: in linearRGB the map values are re-encoded and every offset is wrong
  node.setAttribute('color-interpolation-filters', 'sRGB');
  const map = `<feImage href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>`;
  if (o.aberration > 0) {
    // Split R/G/B with slightly different strengths: subtle dispersion at the rim (costs 3x).
    const s = (k) => (2 * o.strength * k).toFixed(2);
    node.innerHTML = `${map}
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${s(1 + o.aberration)}" xChannelSelector="R" yChannelSelector="G" result="dr"/>
      <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${s(1)}" xChannelSelector="R" yChannelSelector="G" result="dg"/>
      <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${s(1 - o.aberration)}" xChannelSelector="R" yChannelSelector="G" result="db"/>
      <feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
      <feComposite in="r" in2="g" operator="arithmetic" k2="1" k3="1" result="rg"/>
      <feComposite in="rg" in2="b" operator="arithmetic" k2="1" k3="1"/>`;
  } else {
    node.innerHTML = `${map}<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>`;
  }
  ensureDefs().appendChild(node);
  filters.set(key, { id, node });
  if (filters.size > MAX_FILTERS) {
    const [oldKey, old] = filters.entries().next().value;
    filters.delete(oldKey);
    old.node.remove();
  }
  return id;
}

function resolveRadius(el, w, h) {
  const raw = getComputedStyle(el).borderTopLeftRadius.split(' ')[0];
  const value = parseFloat(raw) || 0;
  const r = raw.endsWith('%') ? (value / 100) * Math.min(w, h) : value;
  return Math.min(r, w / 2, h / 2);
}

function attachRefraction(el, opts = {}) {
  let timer = 0;
  let appliedFor = '';
  const apply = () => {
    if (getTier() < 2) {
      el.style.removeProperty('--lg-refract');
      appliedFor = '';
      return;
    }
    const w = el.offsetWidth; // layout size: unaffected by transforms, so press/scale keep the map valid
    const h = el.offsetHeight;
    if (!w || !h) return;
    const r = resolveRadius(el, w, h);
    const minSide = Math.min(w, h);
    const bezel = Math.min(opts.bezel ?? clamp(minSide * 0.35, 8, 24), minSide / 2);
    const o = {
      bezel,
      strength: opts.strength ?? bezel,
      aberration: opts.aberration ?? (getTier() >= 3 ? 0.08 : 0),
      profile: opts.profile ?? 3,
      ior: opts.ior ?? 1.5,
    };
    el.style.setProperty('--lg-refract', `url(#${getFilter(w, h, r, o)})`);
    appliedFor = `${w}x${h}`;
  };
  const ro = new ResizeObserver(() => {
    if (`${el.offsetWidth}x${el.offsetHeight}` === appliedFor) return;
    // Size changed: a stale map would bend the wrong pixels. Drop it now, rebuild once the size settles.
    el.style.removeProperty('--lg-refract');
    appliedFor = '';
    clearTimeout(timer);
    timer = setTimeout(apply, 140);
  });
  apply();
  ro.observe(el);
  const off = onTierChange(apply);
  return () => {
    ro.disconnect();
    off();
    clearTimeout(timer);
    el.style.removeProperty('--lg-refract');
  };
}

// ---------------------------------------------------------------------------
// Interaction: press swell, light from the touch point, jelly stretch, springy release
// ---------------------------------------------------------------------------
const PRESS_GROW_PX = 8; // absolute growth of the longer side
const PRESS_MAX_SCALE = 1.12;
const DRAG_STRETCH = 0.06; // max extra stretch along the drag axis
const DRAG_FOLLOW_PX = 4; // max offset toward the pointer

/** Apple-style rubber band: resistance grows with distance, never exceeds `dimension`. */
export const rubberBand = (offset, dimension, c = 0.55) =>
  Math.sign(offset) * (1 - 1 / ((Math.abs(offset) * c) / dimension + 1)) * dimension;

function attachInteraction(el, opts = {}) {
  const sx = new Spring(1, MOTION.press);
  const sy = new Spring(1, MOTION.press);
  const tx = new Spring(0, MOTION.interactive);
  const ty = new Spring(0, MOTION.interactive);
  const drv = springDriver(() => {
    el.style.scale = `${sx.value.toFixed(4)} ${sy.value.toFixed(4)}`;
    el.style.translate = `${tx.value.toFixed(2)}px ${ty.value.toFixed(2)}px`;
  });
  drv.add(sx, sy, tx, ty);

  let pressed = false;
  let rect = null;
  let base = 1;
  let glowRaf = 0;
  let glowPoint = null;

  const setGlow = (e) => {
    glowPoint = e;
    if (glowRaf) return;
    glowRaf = requestAnimationFrame(() => {
      glowRaf = 0;
      const r = rect ?? el.getBoundingClientRect();
      el.style.setProperty('--lg-px', `${(((glowPoint.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      el.style.setProperty('--lg-py', `${(((glowPoint.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    });
  };

  const down = (e) => {
    if (e.button !== 0 || el.matches(':disabled')) return;
    pressed = true;
    rect = el.getBoundingClientRect();
    el.dataset.lgPressed = '';
    setGlow(e);
    if (prefersReducedMotion() || opts.scale === false) return;
    base = clamp(1 + PRESS_GROW_PX / Math.max(el.offsetWidth, el.offsetHeight), 1, opts.maxScale ?? PRESS_MAX_SCALE);
    sx.configure(MOTION.press).target = base;
    sy.configure(MOTION.press).target = base;
    drv.kick();
  };

  const move = (e) => {
    setGlow(e);
    if (!pressed || !rect || prefersReducedMotion() || opts.scale === false) return;
    // Jelly: lean toward the finger and stretch along the drag axis.
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const fx = rubberBand(dx, rect.width) / rect.width; // -1..1
    const fy = rubberBand(dy, rect.height) / rect.height;
    tx.configure(MOTION.interactive).target = fx * DRAG_FOLLOW_PX * 2;
    ty.configure(MOTION.interactive).target = fy * DRAG_FOLLOW_PX * 2;
    const stretchX = Math.abs(fx) * DRAG_STRETCH;
    const stretchY = Math.abs(fy) * DRAG_STRETCH;
    sx.configure(MOTION.interactive).target = base * (1 + stretchX - stretchY * 0.5);
    sy.configure(MOTION.interactive).target = base * (1 + stretchY - stretchX * 0.5);
    drv.kick();
  };

  const up = () => {
    if (!pressed) return;
    pressed = false;
    rect = null;
    delete el.dataset.lgPressed;
    // Release keeps the current velocity: this is what makes the wobble feel liquid.
    for (const s of [sx, sy]) s.configure(MOTION.release).target = 1;
    for (const s of [tx, ty]) s.configure(MOTION.release).target = 0;
    drv.kick();
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    el.removeEventListener('lostpointercapture', up);
    drv.stop();
    cancelAnimationFrame(glowRaf);
    el.style.removeProperty('scale');
    el.style.removeProperty('translate');
  };
}

// ---------------------------------------------------------------------------
// Public: enhance one element
// ---------------------------------------------------------------------------
const enhanced = new WeakMap();

/**
 * enhance(el, { lens?, interactive?, bezel?, strength?, aberration?, profile?, ior?, scale?, maxScale? })
 * Returns a cleanup function (use it in React useEffect / Vue unmounted / Svelte destroy).
 */
export function enhance(el, opts = {}) {
  if (!el || !hasWindow) return () => {};
  enhanced.get(el)?.();
  const cleanups = [];
  const lens = opts.lens ?? el.classList.contains('lg-lens');
  if (lens && isChromium()) cleanups.push(attachRefraction(el, opts));
  const interactive = opts.interactive ?? el.classList.contains('lg-interactive');
  if (interactive) cleanups.push(attachInteraction(el, opts));
  const dispose = () => {
    cleanups.forEach((fn) => fn());
    enhanced.delete(el);
  };
  enhanced.set(el, dispose);
  return dispose;
}

// ---------------------------------------------------------------------------
// Liquid selection indicator (tab bar, segmented control)
// ---------------------------------------------------------------------------
/**
 * liquidIndicator(track, { indicator, items, selected, onChange, draggable })
 * The two edges of the indicator are separate springs: the leading edge is stiffer,
 * so the blob stretches toward the destination and then contracts (liquid feel).
 * While dragged it becomes a clear lens that follows the finger and snaps to the nearest item.
 */
export function liquidIndicator(track, opts = {}) {
  const indicator = opts.indicator ?? track.querySelector('.lg-indicator');
  const items = opts.items ?? [...track.querySelectorAll('[role="tab"], .lg-tab, .lg-seg__item')];
  const left = new Spring(0, MOTION.snappy);
  const right = new Spring(0, MOTION.snappy);
  const grow = new Spring(1, MOTION.press);
  let index = clamp(opts.selected ?? 0, 0, items.length - 1);
  let drag = null;

  const drv = springDriver(() => {
    const width = Math.max(0, right.value - left.value);
    indicator.style.transform = `translateX(${left.value.toFixed(2)}px)`;
    indicator.style.width = `${width.toFixed(2)}px`;
    indicator.style.scale = grow.value.toFixed(4);
  });
  drv.add(left, right, grow);

  const measure = (i) => {
    const t = track.getBoundingClientRect();
    const r = items[i].getBoundingClientRect();
    return { l: r.left - t.left, r: r.right - t.left };
  };

  function select(i, { animate = true, notify = false } = {}) {
    index = clamp(i, 0, items.length - 1);
    const m = measure(index);
    if (!animate || prefersReducedMotion()) {
      left.set(m.l);
      right.set(m.r);
    } else {
      const movingRight = m.l > left.value;
      right.configure(movingRight ? MOTION.lead : MOTION.trail);
      left.configure(movingRight ? MOTION.trail : MOTION.lead);
      left.target = m.l;
      right.target = m.r;
    }
    items.forEach((it, j) => {
      it.setAttribute('aria-selected', String(j === index));
      it.tabIndex = j === index ? 0 : -1;
    });
    drv.kick();
    if (notify) opts.onChange?.(index);
  }

  const onClick = (e) => {
    const i = items.indexOf(e.target.closest('[role="tab"], .lg-tab, .lg-seg__item'));
    if (i >= 0 && !drag?.moved) select(i, { notify: i !== index });
  };

  const onKey = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = clamp(Number.isFinite(step) ? index + step : step > 0 ? items.length - 1 : 0, 0, items.length - 1);
    select(next, { notify: next !== index });
    items[next].focus();
  };

  const onDown = (e) => {
    if (opts.draggable === false || e.button !== 0) return;
    const t = track.getBoundingClientRect();
    drag = { startX: e.clientX, originL: left.value, width: right.value - left.value, trackL: t.left, moved: false };
  };
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      track.setPointerCapture?.(e.pointerId);
      indicator.dataset.lgDragging = '';
      grow.configure(MOTION.press).target = prefersReducedMotion() ? 1 : 1.1;
    }
    const trackW = track.clientWidth;
    const l = clamp(drag.originL + dx, 0, trackW - drag.width);
    left.configure(MOTION.interactive).target = l;
    right.configure(MOTION.interactive).target = l + drag.width;
    drv.kick();
  };
  const onUp = () => {
    if (!drag) return;
    const wasDragging = drag.moved;
    if (wasDragging) {
      delete indicator.dataset.lgDragging;
      grow.configure(MOTION.release).target = 1;
      const center = (left.target + right.target) / 2;
      let best = 0;
      let bestDist = Infinity;
      items.forEach((_, i) => {
        const m = measure(i);
        const d = Math.abs((m.l + m.r) / 2 - center);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      select(best, { notify: best !== index });
    }
    // let the click that follows this pointerup see `moved`, then reset
    setTimeout(() => (drag = null), 0);
  };

  const ro = new ResizeObserver(() => select(index, { animate: false }));
  track.setAttribute('role', track.getAttribute('role') ?? 'tablist');
  track.addEventListener('click', onClick);
  track.addEventListener('keydown', onKey);
  track.addEventListener('pointerdown', onDown);
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerup', onUp);
  track.addEventListener('pointercancel', onUp);
  ro.observe(track);
  select(index, { animate: false });

  return {
    select: (i) => select(i, { notify: false }),
    get index() {
      return index;
    },
    destroy() {
      ro.disconnect();
      drv.stop();
      track.removeEventListener('click', onClick);
      track.removeEventListener('keydown', onKey);
      track.removeEventListener('pointerdown', onDown);
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onUp);
    },
  };
}

// ---------------------------------------------------------------------------
// Morph: a button grows into its menu/popover (one glass surface changes shape)
// ---------------------------------------------------------------------------
/**
 * morphOpen(source, panel) -> { close() }
 * `panel` is a positioned .lg element with [hidden]; its first child should be .lg-menu__content.
 * The panel starts at the source's rect/radius and springs to its own layout (FLIP with
 * radius compensation), the source hides, content fades in during the last ~40%.
 */
export function morphOpen(source, panel, { onClose } = {}) {
  const content = panel.querySelector('.lg-menu__content') ?? panel.firstElementChild;
  panel.hidden = false;
  const s = source.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const r0 = Math.min(s.width, s.height) / 2;
  const r1 = resolveRadius(panel, p.width, p.height);
  const reduced = prefersReducedMotion();
  const progress = new Spring(0, MOTION.morph);

  source.setAttribute('aria-expanded', 'true');
  const render = () => {
    const t = progress.value;
    if (reduced) {
      panel.style.opacity = String(clamp(t, 0, 1));
      return;
    }
    const x = lerp(s.left, p.left, t) - p.left;
    const y = lerp(s.top, p.top, t) - p.top;
    const kx = Math.max(0.05, lerp(s.width, p.width, t) / p.width);
    const ky = Math.max(0.05, lerp(s.height, p.height, t) / p.height);
    const r = lerp(r0, r1, clamp(t, 0, 1));
    panel.style.transform = `translate(${x}px, ${y}px) scale(${kx}, ${ky})`;
    panel.style.borderRadius = `${(r / kx).toFixed(2)}px / ${(r / ky).toFixed(2)}px`;
    source.style.opacity = t > 0.02 ? '0' : '';
    if (content) {
      content.style.transform = `scale(${1 / kx}, ${1 / ky})`;
      content.style.opacity = String(clamp((t - 0.55) / 0.45, 0, 1));
    }
  };
  const drv = springDriver(render);
  drv.add(progress);
  progress.target = 1;
  render();
  drv.kick();

  const finishClose = () => {
    panel.hidden = true;
    for (const prop of ['transform', 'borderRadius', 'opacity']) panel.style[prop] = '';
    if (content) content.style.transform = content.style.opacity = '';
    source.style.opacity = '';
    source.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc);
    onClose?.();
  };
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    progress.configure(MOTION.dismiss).target = 0;
    const check = () => (progress.atRest ? finishClose() : requestAnimationFrame(check));
    drv.kick();
    requestAnimationFrame(check);
    source.focus({ preventScroll: true });
  };
  const outside = (e) => {
    if (!panel.contains(e.target) && !source.contains(e.target)) close();
  };
  const esc = (e) => e.key === 'Escape' && close();
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', esc);
  requestAnimationFrame(() => panel.querySelector('button, [href], [tabindex]')?.focus({ preventScroll: true }));
  return { close };
}

// ---------------------------------------------------------------------------
// Adaptive appearance: flip glass to dark/light by the section underneath
// ---------------------------------------------------------------------------
/**
 * Mark top-level sections with data-lg-surface="light|dark|auto" (auto = follows the page theme).
 * A fixed/sticky glass element with data-lg-adaptive gets data-lg-appearance of the section under
 * its vertical center. No pixel readback: an IntersectionObserver with a 1px root band does the work.
 */
export function adaptiveAppearance(el, { surfaces = '[data-lg-surface]' } = {}) {
  let io = null;
  const setup = () => {
    io?.disconnect();
    const r = el.getBoundingClientRect();
    const cy = Math.round(r.top + r.height / 2);
    const bottom = Math.max(0, Math.round(innerHeight - cy - 1));
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const surface = e.target.dataset.lgSurface;
          if (surface === 'light' || surface === 'dark') el.dataset.lgAppearance = surface;
          else delete el.dataset.lgAppearance;
        }
      },
      { rootMargin: `-${cy}px 0px -${bottom}px 0px`, threshold: 0 },
    );
    document.querySelectorAll(surfaces).forEach((s) => io.observe(s));
  };
  setup();
  addEventListener('resize', setup);
  return () => {
    io?.disconnect();
    removeEventListener('resize', setup);
  };
}

// ---------------------------------------------------------------------------
// Frame guard: drop one tier when frames are consistently late
// ---------------------------------------------------------------------------
export function fpsGuard({ sampleMs = 2500, slowShare = 0.2, onDowngrade } = {}) {
  let raf = 0;
  let last = 0;
  let start = 0;
  const deltas = [];
  const tick = (now) => {
    if (document.hidden) {
      last = 0;
      raf = requestAnimationFrame(tick);
      return;
    }
    if (last) deltas.push(now - last);
    else if (!start) start = now;
    last = now;
    if (now - start < sampleMs) {
      raf = requestAnimationFrame(tick);
      return;
    }
    const sorted = [...deltas].sort((a, b) => a - b);
    const frame = sorted[Math.floor(sorted.length * 0.25)] || 1000 / 60; // the display's own cadence
    const slow = deltas.filter((d) => d > frame * 1.8).length / Math.max(1, deltas.length);
    if (slow > slowShare && getTier() > 0) {
      setTier(Math.max(1, getTier() - 1)); // never auto-drop to solid: that is an accessibility choice
      onDowngrade?.(getTier());
    }
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
/**
 * initLiquidGlass({ root, tier: 'auto' | 0..3, guard })
 * Enhances .lg-lens, .lg-interactive and [data-lg-adaptive] inside `root`, keeps the tier in sync
 * with accessibility settings. Returns a cleanup function.
 */
export function initLiquidGlass({ root = document, tier: forced = 'auto', guard = true } = {}) {
  if (!hasWindow) return () => {};
  const cleanups = [];
  const refreshTier = () => setTier(forced === 'auto' ? detectTier() : forced);
  refreshTier();
  for (const q of ['(prefers-reduced-transparency: reduce)', '(forced-colors: active)']) {
    const m = matchMedia(q);
    m.addEventListener?.('change', refreshTier);
    cleanups.push(() => m.removeEventListener?.('change', refreshTier));
  }
  root.querySelectorAll('.lg-lens, .lg-interactive').forEach((el) => cleanups.push(enhance(el)));
  root.querySelectorAll('[data-lg-adaptive]').forEach((el) => cleanups.push(adaptiveAppearance(el)));
  if (guard && forced === 'auto') cleanups.push(fpsGuard());
  return () => cleanups.forEach((fn) => fn());
}
