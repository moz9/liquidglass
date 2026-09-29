// Liquid Glass — edge refraction for Flutter `ImageFilter.shader` (Impeller only).
//
//   BackdropFilter(
//     filter: ImageFilter.compose(
//       outer: ImageFilter.shader(shader),                               // this file
//       inner: ImageFilter.compose(outer: ColorFilter.matrix(saturation), // frosted backdrop
//                                  inner: ImageFilter.blur(sigmaX: 10, sigmaY: 10))),
//     child: ...)
//
// Engine contract for ImageFilter.shader: the FIRST uniform is a vec2 that the engine sets to
// the input texture size, the FIRST sampler2D receives the filter input. Custom float uniforms
// therefore start at index 2 in FragmentShader.setFloat().
//
// uRect must be expressed in the input texture's pixel space. Whether that texture covers the
// whole backdrop or only the clip bounds depends on the engine version/backend: turn on uDebug,
// check that the red shape sits exactly under your widget, and adjust uRect once.
// Model: docs/03-optics.md. Fill, rim and shadow are drawn by widgets on every tier.

#version 460 core
#include <flutter/runtime_effect.glsl>

uniform vec2 uSize;          // index 0-1: set by the engine
uniform sampler2D uTexture;  // set by the engine
uniform vec4 uRect;          // index 2-5: left, top, width, height (physical px)
uniform float uRadius;       // index 6: corner radius (physical px)
uniform float uBezel;        // index 7: refraction band (physical px)
uniform float uStrength;     // index 8: max displacement at the rim (physical px)
uniform float uIor;          // index 9: 1.5
uniform float uProfile;      // index 10: 3
uniform float uAberration;   // index 11: 0 (T2) .. 0.08 (T3)
uniform float uDebug;        // index 12: 1 = visualize the SDF

out vec4 fragColor;

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdf(vec2 frag) {
  return sdRoundRect(frag - (uRect.xy + uRect.zw * 0.5), uRect.zw * 0.5, uRadius);
}

float profileH(float t) {
  return pow(1.0 - pow(1.0 - t, uProfile), 1.0 / uProfile);
}

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

void main() {
  vec2 frag = FlutterFragCoord().xy;
  float d = sdf(frag);

  if (uDebug > 0.5) {
    fragColor = vec4(d < 0.0 ? 1.0 : 0.0, clamp(-d / uBezel, 0.0, 1.0), 0.0, 1.0);
    return;
  }
  if (d > 0.0) {
    fragColor = texture(uTexture, frag / uSize);
    return;
  }

  vec2 e = vec2(0.5, 0.0);
  vec2 n = normalize(vec2(sdf(frag + e.xy) - sdf(frag - e.xy), sdf(frag + e.yx) - sdf(frag - e.yx)) + 1e-5);
  float t = clamp(-d / uBezel, 0.0, 1.0);
  vec2 off = -n * deflection(t) * uStrength;

  vec4 c = texture(uTexture, (frag + off) / uSize);
  if (uAberration > 0.0) {
    c.r = texture(uTexture, (frag + off * (1.0 + uAberration)) / uSize).r;
    c.b = texture(uTexture, (frag + off * (1.0 - uAberration)) / uSize).b;
  }
  fragColor = c;
}
