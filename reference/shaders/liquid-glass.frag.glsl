// GENERATED from reference/web/liquid-glass-webgl.js (FRAGMENT_SHADER) by `node tools/check.mjs --write`. Do not edit.
#version 300 es
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
