#!/usr/bin/env node
// Liquid Glass spring converter.
// One spring definition (response + dampingRatio, SwiftUI semantics) -> parameters for every stack.
//
//   node tools/spring.mjs --tokens                      # table for all motion tokens
//   node tools/spring.mjs --response 0.35 --damping 0.7 # one custom spring
//   node tools/spring.mjs --response 0.35 --bounce 0.3  # bounce = 1 - dampingRatio
//   node tools/spring.mjs --tokens --css                # also print CSS linear() easings
//
// Math (mass m = 1):
//   omega     = 2*PI / response
//   stiffness = omega^2
//   damping   = 2 * dampingRatio * omega      (= 4*PI*dampingRatio / response)
//   bounce    = 1 - dampingRatio               (SwiftUI / UIKit spring(duration:bounce:))

export const MOTION_TOKENS = {
  interactive: { response: 0.15, dampingRatio: 0.86, use: 'element follows the finger/pointer 1:1 (drag)' },
  press:       { response: 0.22, dampingRatio: 0.65, use: 'glass swells on press' },
  release:     { response: 0.38, dampingRatio: 0.55, use: 'jelly return after release (visible wobble)' },
  snappy:      { response: 0.30, dampingRatio: 0.85, use: 'selection indicator, toggles, small state changes' },
  morph:       { response: 0.42, dampingRatio: 0.78, use: 'button -> menu/popover, merge/split of glass' },
  bouncy:      { response: 0.50, dampingRatio: 0.70, use: 'materialize (appearance) of small glass elements' },
  smooth:      { response: 0.50, dampingRatio: 1.00, use: 'sheets, large panels, Reduce Motion replacement' },
};

export function springParams({ response, dampingRatio }) {
  const omega = (2 * Math.PI) / response;
  return {
    response,
    dampingRatio,
    bounce: 1 - dampingRatio,
    mass: 1,
    stiffness: omega * omega,
    damping: 2 * dampingRatio * omega,
    omega,
  };
}

// Step response x(t) of a spring going 0 -> 1 with zero initial velocity.
export function stepResponse({ response, dampingRatio }, t) {
  const w = (2 * Math.PI) / response;
  const z = dampingRatio;
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
  }
  if (z === 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const s = Math.sqrt(z * z - 1);
  const r1 = -w * (z - s);
  const r2 = -w * (z + s);
  const c2 = r1 / (r2 - r1); // x0 = -1, v0 = 0 in error space
  const c1 = -1 - c2;
  return 1 + c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
}

// Time after which |1 - x(t)| stays below epsilon.
export function settleTime(spring, epsilon = 0.001) {
  const dt = 0.001;
  let last = 0;
  for (let t = 0; t < 10; t += dt) {
    if (Math.abs(1 - stepResponse(spring, t)) > epsilon) last = t;
  }
  return last + dt;
}

// CSS linear() easing that reproduces the spring; use together with the returned duration.
export function cssLinear(spring, { points = 48, epsilon = 0.001 } = {}) {
  const duration = settleTime(spring, epsilon);
  const values = [];
  for (let i = 0; i <= points; i++) {
    const x = i === points ? 1 : stepResponse(spring, (duration * i) / points);
    values.push(+x.toFixed(4));
  }
  return { duration: Math.round(duration * 1000), easing: `linear(${values.join(', ')})` };
}

function f(n, d = 2) {
  return Number(n.toFixed(d)).toString();
}

export function platformSnippets(spring) {
  const p = springParams(spring);
  const { duration } = cssLinear(spring);
  const ms = Math.round(p.response * 1000);
  return {
    'SwiftUI': `.spring(response: ${f(p.response)}, dampingFraction: ${f(p.dampingRatio)})  // = .spring(duration: ${f(p.response)}, bounce: ${f(p.bounce)})`,
    'UIKit (iOS 17+)': `UIView.animate(springDuration: ${f(p.response)}, bounce: ${f(p.bounce)}) { ... }`,
    'Jetpack Compose': `spring(dampingRatio = ${f(p.dampingRatio)}f, stiffness = ${f(p.stiffness, 1)}f)`,
    'Android SpringForce': `SpringForce(1f).setDampingRatio(${f(p.dampingRatio)}f).setStiffness(${f(p.stiffness, 1)}f)`,
    'Flutter': `SpringDescription(mass: 1, stiffness: ${f(p.stiffness, 1)}, damping: ${f(p.damping, 2)})`,
    'WinUI 3 / UWP': `spring.DampingRatio = ${f(p.dampingRatio)}f; spring.Period = TimeSpan.FromMilliseconds(${ms});`,
    'Motion / Framer Motion': `{ type: "spring", stiffness: ${f(p.stiffness, 1)}, damping: ${f(p.damping, 2)}, mass: 1 }`,
    'React Native Reanimated': `withSpring(to, { mass: 1, stiffness: ${f(p.stiffness, 1)}, damping: ${f(p.damping, 2)} })`,
    'CSS': `transition-duration: ${duration}ms; transition-timing-function: var(--lg-ease-…)  // node tools/spring.mjs --css`,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = Number(next); i++; }
  }
  return out;
}

function printTable() {
  const rows = Object.entries(MOTION_TOKENS).map(([name, s]) => {
    const p = springParams(s);
    return {
      token: name,
      response: f(p.response),
      dampingRatio: f(p.dampingRatio),
      bounce: f(p.bounce),
      stiffness: f(p.stiffness, 1),
      damping: f(p.damping, 2),
      'settle(ms)': Math.round(settleTime(s) * 1000),
      use: s.use,
    };
  });
  console.table(rows);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.tokens) {
    printTable();
    if (args.css) {
      console.log('\n/* CSS spring easings (paste into :root) */');
      for (const [name, s] of Object.entries(MOTION_TOKENS)) {
        const { duration, easing } = cssLinear(s);
        console.log(`--lg-ease-${name}: ${easing};`);
        console.log(`--lg-dur-${name}: ${duration}ms;`);
      }
    }
  } else if (args.response) {
    const dampingRatio = args.damping ?? (args.bounce !== undefined ? 1 - args.bounce : 0.8);
    const s = { response: args.response, dampingRatio };
    const p = springParams(s);
    console.log(`response=${f(p.response)}s dampingRatio=${f(p.dampingRatio)} bounce=${f(p.bounce)} stiffness=${f(p.stiffness, 1)} damping=${f(p.damping, 2)} settle=${Math.round(settleTime(s) * 1000)}ms\n`);
    for (const [k, v] of Object.entries(platformSnippets(s))) console.log(`${k.padEnd(26)} ${v}`);
    if (args.css) {
      const { duration, easing } = cssLinear(s);
      console.log(`\n--lg-ease-custom: ${easing};\n--lg-dur-custom: ${duration}ms;`);
    }
  } else {
    console.log('Usage: node tools/spring.mjs --tokens [--css] | --response <s> (--damping <ratio> | --bounce <b>) [--css]');
  }
}
