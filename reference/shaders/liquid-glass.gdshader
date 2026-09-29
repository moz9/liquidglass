// Liquid Glass — Godot 4 canvas_item shader (Control / ColorRect / Panel).
// The node samples the screen behind it: refraction + mip-level blur + saturation + fill + rim.
// Set size_px from a script on resize: material.set_shader_parameter("size_px", size)
// If the refraction looks vertically mirrored on your renderer, flip off.y.
// Model: docs/03-optics.md.
shader_type canvas_item;

uniform sampler2D screen_texture : hint_screen_texture, filter_linear_mipmap;
uniform vec2 size_px = vec2(320.0, 62.0);
uniform float radius = 31.0;        // corner radius, px (capsule: min(size) / 2)
uniform float bezel = 20.0;         // clamp(minSide * 0.35, 8, 24)
uniform float strength = 20.0;      // = bezel
uniform float ior = 1.5;
uniform float profile = 3.0;
uniform float blur_lod = 2.5;       // mip level as a cheap blur (≈ sigma 10 at 1x)
uniform float saturation = 1.8;
uniform vec4 fill : source_color = vec4(1.0, 1.0, 1.0, 0.2);
uniform vec2 light_dir = vec2(-0.6, -0.8);
uniform float rim_intensity = 0.9;

float sd_round_rect(vec2 p, vec2 b, float r) {
	vec2 q = abs(p) - b + r;
	return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

float sdf(vec2 p) {
	return sd_round_rect(p - size_px * 0.5, size_px * 0.5, radius);
}

float profile_h(float t) {
	return pow(1.0 - pow(1.0 - t, profile), 1.0 / profile);
}

float deflection(float t) {
	float theta = 1.5707963;
	if (t > 0.001) {
		float a = max(t - 0.002, 0.0);
		float b = min(t + 0.002, 1.0);
		theta = atan((profile_h(b) - profile_h(a)) / (b - a));
	}
	float theta_t = asin(sin(theta) / ior);
	float edge = 1.5707963 - asin(1.0 / ior);
	return tan(theta - theta_t) / tan(edge);
}

void fragment() {
	vec2 p = UV * size_px;
	float d = sdf(p);
	if (d > 0.5) {
		discard;
	}
	vec2 e = vec2(0.5, 0.0);
	vec2 n = normalize(vec2(sdf(p + e.xy) - sdf(p - e.xy), sdf(p + e.yx) - sdf(p - e.yx)) + 1e-5);
	float t = clamp(-d / bezel, 0.0, 1.0);
	vec2 off = -n * deflection(t) * strength;

	vec3 col = textureLod(screen_texture, SCREEN_UV + off * SCREEN_PIXEL_SIZE, blur_lod).rgb;
	col = clamp(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation), 0.0, 1.0);
	col = mix(col, fill.rgb, fill.a);

	float facing = dot(n, normalize(light_dir));
	float rim = 1.0 - smoothstep(0.0, 1.6, -d);
	float sheen = pow(1.0 - t, 3.0);
	col += (rim * (0.3 + 0.7 * max(facing, 0.0) + 0.45 * max(-facing, 0.0)) + sheen * 0.16 * (0.5 + 0.5 * facing)) * rim_intensity;

	COLOR = vec4(clamp(col, 0.0, 1.0), clamp(0.5 - d, 0.0, 1.0));
}
