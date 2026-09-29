/*
 * Liquid Glass — tier T3 for the web: shader glass on a WebGL2 canvas.
 *
 * Use it when the backdrop is something you render yourself (image, video, canvas scene,
 * map, 3D view). DOM content cannot be sampled by WebGL, so for regular pages stay with
 * liquid-glass.css/.js (T1/T2).
 *
 * What the shader does (docs/03-optics.md):
 *   - N rounded rectangles combined with a smooth union -> droplets merge and split
 *   - Snell refraction in the bezel band from the SDF normal and a convex height profile
 *   - frosted backdrop (pre-blurred texture), saturation, appearance fill, tint
 *   - chromatic dispersion at the rim, specular rim facing the light, soft outer shadow
 *
 * The same fragment shader is ported to AGSL / Flutter / HLSL in reference/shaders/.
 * Source of truth for the GLSL: FRAGMENT_SHADER below (tools/check.mjs keeps the .glsl copy in sync).
 */

export const MAX_SHAPES = 8;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uRes;          // canvas size in CSS px
uniform float uDpr;         // device pixel ratio
uniform sampler2D uBg;      // backdrop, sharp
uniform sampler2D uBgBlur;  // backdrop, pre-blurred (sigma = blur token)
uniform int uCount;         // number of shapes
uniform vec4 uShape[8];     // center.xy, half-size.xy (CSS px)
uniform float uRadius[8];   // corner radius (CSS px)
uniform float uMerge;       // smooth-union distance (CSS px), 0 = shapes never melt
uniform float uBezel;       // refraction band width (CSS px)
uniform float uStrength;    // max displacement at the rim (CSS px)
uniform float uIor;         // index of refraction, 1.5
uniform float uProfile;     // bezel profile exponent: 2 = circle, 4 = squircle
uniform float uAberration;  // chromatic dispersion, 0 .. 0.15
uniform vec4 uTint;         // tint rgb + amount
uniform vec2 uLight;        // unit vector toward the light, screen space (y down)
uniform float uDark;        // 0 = light appearance, 1 = dark appearance

out vec4 fragColor;

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// Polynomial smooth minimum: shapes closer than k melt into one droplet.
float smin(float a, float b, float k) {
  if (k <= 0.0) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float scene(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    d = smin(d, sdRoundRect(p - uShape[i].xy, uShape[i].zw, uRadius[i]), uMerge);
  }
  return d;
}

float profileH(float t) {
  return pow(1.0 - pow(1.0 - t, uProfile), 1.0 / uProfile);
}

// Snell deflection across the bezel: 1.0 at the rim, 0.0 in the flat core.
float deflection(float t) {
  float theta = 1.5707963;
  if (t > 0.001) {
    float a = max(t - 0.002, 0.0);
    float b = min(t + 0.002, 1.0);
    theta = atan((profileH(b) - profileH(a)) / (b - a));
  }
  float thetaT = asin(sin(theta) / uIor);
  float edge = 1.5707963 - asin(1.0 / uIor);
  return tan(theta - thetaT) / tan(edge);
}

vec3 saturateColor(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return clamp(mix(vec3(l), c, s), 0.0, 1.0);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 px = 1.0 / uRes;
  vec3 bg = texture(uBg, p * px).rgb;

  float d = scene(p);

  // Soft ambient shadow, slightly offset down.
  float ds = scene(p - vec2(0.0, 6.0));
  float shadow = (1.0 - smoothstep(-4.0, 22.0, ds)) * mix(0.16, 0.34, uDark);
  vec3 outside = bg * (1.0 - shadow);
  if (d > 1.0) {
    fragColor = vec4(outside, 1.0);
    return;
  }

  // Outward normal from the SDF gradient.
  vec2 e = vec2(0.5, 0.0);
  vec2 n = normalize(vec2(scene(p + e.xy) - scene(p - e.xy), scene(p + e.yx) - scene(p - e.yx)) + 1e-6);

  // Refraction: a convex bezel bends rays toward the center -> sample inward.
  float t = clamp(-d / uBezel, 0.0, 1.0);
  vec2 off = -n * deflection(t) * uStrength;
  vec3 col;
  col.r = texture(uBgBlur, (p + off * (1.0 + uAberration)) * px).r;
  col.g = texture(uBgBlur, (p + off) * px).g;
  col.b = texture(uBgBlur, (p + off * (1.0 - uAberration)) * px).b;

  // Material: vibrancy, appearance fill, optional tint.
  col = saturateColor(col, 1.6);
  col *= mix(1.04, 0.88, uDark);
  col = mix(col, mix(vec3(1.0), vec3(0.12), uDark), mix(0.12, 0.3, uDark));
  col = mix(col, uTint.rgb, uTint.a);

  // Specular: thin rim line lit on the side facing the light, weaker on the opposite side
  // (light that entered the glass exits there), plus a broad sheen inside the bezel.
  float facing = dot(n, uLight);
  float rim = 1.0 - smoothstep(0.0, 1.6, -d);
  float sheen = pow(1.0 - t, 3.0);
  float spec = rim * (0.3 + 0.7 * max(facing, 0.0) + 0.45 * max(-facing, 0.0)) + sheen * 0.16 * (0.5 + 0.5 * facing);
  col += spec * mix(0.9, 0.55, uDark);

  // Anti-aliased silhouette.
  float cover = clamp(0.5 - d, 0.0, 1.0);
  fragColor = vec4(mix(outside, clamp(col, 0.0, 1.0), cover), 1.0);
}
`;

const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function texture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/**
 * createLiquidGlassCanvas(canvas, options) -> controller | null (no WebGL2)
 *
 * options:
 *   drawBackground(ctx, width, height)  paints the backdrop in CSS px (called on resize)
 *   shapes: [{ x, y, w, h, r }]          centers + sizes in CSS px (mutate, then render())
 *   blur = 10, merge = 24, bezel = 18, strength = 14, ior = 1.5, profile = 3,
 *   aberration = 0.06, tint = [r, g, b, amount], light = [-0.6, -0.8], dark = false
 */
export function createLiquidGlassCanvas(canvas, options = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) return null;
  const o = {
    blur: 10,
    merge: 24,
    bezel: 18,
    strength: 14,
    ior: 1.5,
    profile: 3,
    aberration: 0.06,
    tint: [0, 0, 0, 0],
    light: [-0.6, -0.8],
    dark: false,
    shapes: [],
    ...options,
  };

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = (name) => gl.getUniformLocation(prog, name);
  const U = Object.fromEntries(
    ['uRes', 'uDpr', 'uBg', 'uBgBlur', 'uCount', 'uShape', 'uRadius', 'uMerge', 'uBezel', 'uStrength', 'uIor', 'uProfile', 'uAberration', 'uTint', 'uLight', 'uDark'].map((n) => [n, u(n)]),
  );
  const sharp = texture(gl);
  const blurred = texture(gl);
  const shapeData = new Float32Array(MAX_SHAPES * 4);
  const radiusData = new Float32Array(MAX_SHAPES);
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;

  function upload(tex, source) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2); // cap: glass is soft, 3x buys nothing
    cssW = canvas.clientWidth;
    cssH = canvas.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (!o.drawBackground) return;
    const bg = document.createElement('canvas');
    bg.width = canvas.width;
    bg.height = canvas.height;
    const ctx = bg.getContext('2d');
    ctx.scale(dpr, dpr);
    o.drawBackground(ctx, cssW, cssH);
    upload(sharp, bg);
    // Blur ONCE per backdrop change, never per frame. For live backdrops use a half-res dual-Kawase pass.
    const soft = document.createElement('canvas');
    soft.width = bg.width;
    soft.height = bg.height;
    const sctx = soft.getContext('2d');
    sctx.filter = `blur(${o.blur * dpr}px)`;
    sctx.drawImage(bg, 0, 0);
    upload(blurred, soft);
  }

  function render() {
    const n = Math.min(o.shapes.length, MAX_SHAPES);
    for (let i = 0; i < n; i++) {
      const s = o.shapes[i];
      shapeData.set([s.x, s.y, s.w / 2, s.h / 2], i * 4);
      radiusData[i] = Math.min(s.r ?? Math.min(s.w, s.h) / 2, s.w / 2, s.h / 2);
    }
    gl.useProgram(prog);
    gl.uniform2f(U.uRes, cssW, cssH);
    gl.uniform1f(U.uDpr, dpr);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sharp);
    gl.uniform1i(U.uBg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurred);
    gl.uniform1i(U.uBgBlur, 1);
    gl.uniform1i(U.uCount, n);
    gl.uniform4fv(U.uShape, shapeData);
    gl.uniform1fv(U.uRadius, radiusData);
    gl.uniform1f(U.uMerge, o.merge);
    gl.uniform1f(U.uBezel, o.bezel);
    gl.uniform1f(U.uStrength, o.strength);
    gl.uniform1f(U.uIor, o.ior);
    gl.uniform1f(U.uProfile, o.profile);
    gl.uniform1f(U.uAberration, o.aberration);
    gl.uniform4fv(U.uTint, o.tint);
    const len = Math.hypot(o.light[0], o.light[1]) || 1;
    gl.uniform2f(U.uLight, o.light[0] / len, o.light[1] / len);
    gl.uniform1f(U.uDark, o.dark ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const ro = new ResizeObserver(() => {
    resize();
    render();
  });
  ro.observe(canvas);
  resize();

  return {
    options: o,
    shapes: o.shapes,
    render,
    resize,
    destroy() {
      ro.disconnect();
      gl.deleteProgram(prog);
      gl.deleteTexture(sharp);
      gl.deleteTexture(blurred);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
    },
  };
}
