// Liquid Glass — WPF ShaderEffect (Pixel Shader 3.0).
// Compile:  fxc /T ps_3_0 /E main /Fo LiquidGlass.ps LiquidGlass.wpf.hlsl
// Apply to an element that already renders the BLURRED copy of the backdrop (see platforms/windows.md §3).
// Does: edge refraction (docs/03-optics.md), saturation, brightness, specular rim.
// If fxc reports the instruction limit, replace deflection(t) with pow(1 - t, 3).

sampler2D input : register(s0);
float2 sizePx   : register(c0);   // element size in device pixels
float4 shape    : register(c1);   // x = corner radius, y = bezel, z = strength (px), w = IOR
float4 light    : register(c2);   // xy = unit vector toward the light (y down), z = rim intensity, w = profile exponent
float2 material : register(c3);   // x = saturation (1.8), y = brightness (1.05 light / 0.92 dark)

float sdRoundRect(float2 p, float2 b, float r)
{
    float2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0) + length(max(q, 0)) - r;
}

float profileH(float t, float p)
{
    return pow(1 - pow(1 - t, p), 1 / p);
}

float deflection(float t, float ior, float p)
{
    float theta = 1.5707963;
    if (t > 0.001)
    {
        float a = max(t - 0.002, 0);
        float b = min(t + 0.002, 1);
        theta = atan((profileH(b, p) - profileH(a, p)) / (b - a));
    }
    float thetaT = asin(sin(theta) / ior);
    float edge = 1.5707963 - asin(1 / ior);
    return tan(theta - thetaT) / tan(edge);
}

float4 main(float2 uv : TEXCOORD) : COLOR
{
    float2 halfSize = sizePx * 0.5;
    float2 p = uv * sizePx - halfSize;
    float r = shape.x;
    float d = sdRoundRect(p, halfSize, r);
    if (d > 0) return tex2D(input, uv);

    float2 e = float2(0.5, 0);
    float2 n = normalize(float2(sdRoundRect(p + e.xy, halfSize, r) - sdRoundRect(p - e.xy, halfSize, r),
                                sdRoundRect(p + e.yx, halfSize, r) - sdRoundRect(p - e.yx, halfSize, r)) + 1e-5);
    float t = saturate(-d / shape.y);
    float2 offsetPx = -n * deflection(t, shape.w, light.w) * shape.z;   // inward
    float4 c = tex2D(input, uv + offsetPx / sizePx);

    // premultiplied alpha: work on straight color, then re-multiply
    float3 rgb = c.a > 0 ? c.rgb / c.a : 0;
    float luma = dot(rgb, float3(0.2126, 0.7152, 0.0722));
    rgb = saturate(lerp(luma.xxx, rgb, material.x) * material.y);

    float facing = dot(n, light.xy);
    float rim = 1 - smoothstep(0, 1.6, -d);
    float sheen = pow(1 - t, 3);
    float spec = rim * (0.3 + 0.7 * max(facing, 0) + 0.45 * max(-facing, 0)) + sheen * 0.16 * (0.5 + 0.5 * facing);
    rgb = saturate(rgb + spec * light.z);

    return float4(rgb * c.a, c.a);
}
