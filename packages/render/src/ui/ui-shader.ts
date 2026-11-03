/**
 * Programa de UI (o 7º dos 7 programas, regra 8): retângulos com forma por SDF (chanfro, contorno, faixa zebrada),
 * sprites e glifos MSDF num `sampler2DArray`, tudo num draw call. GLSL ES 3.00 puro, sem extensões e sem leitura de
 * textura no vertex shader (regra 6). As cores chegam em sRGB e saem em sRGB, sem conversão (UI não passa por luz).
 */

export const UI_VERTEX_SHADER = /* glsl */ `
precision highp float;

in vec2 position;
in vec2 uv;
in vec4 data0;
in vec4 data1;
in vec4 color;

uniform vec2 viewSize;

out vec2 vUv;
out vec4 vData0;
out vec4 vData1;
out vec4 vColor;

void main() {
  vUv = uv;
  vData0 = data0;
  vData1 = data1;
  vColor = color;
  // px do alvo (origem no topo, y para baixo) → clip space.
  gl_Position = vec4(position.x / viewSize.x * 2.0 - 1.0, 1.0 - position.y / viewSize.y * 2.0, 0.0, 1.0);
}
`;

export const UI_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray atlas;
// px do drawing buffer por px da DrawList: a borda suave tem 1 px de TELA em qualquer DPR.
uniform float pxScale;

in vec2 vUv;
in vec4 vData0;
in vec4 vData1;
in vec4 vColor;

out vec4 fragColor;

float median3(vec3 s) {
  return max(min(s.r, s.g), min(max(s.r, s.g), s.b));
}

void main() {
  vec4 color = vColor;
  float layer = floor(vData0.y + 0.5);
  if (vData0.x < 0.5) {
    // Retângulo: vUv é a coordenada local em px; distância à borda (positiva dentro), com o chanfro de 45°.
    vec2 p = vUv;
    vec2 size = vData0.zw;
    float chamfer = vData1.x;
    float stroke = vData1.y;
    float stripes = vData1.z;
    float d = min(min(p.x, p.y), min(size.x - p.x, size.y - p.y));
    if (chamfer > 0.0) d = min(d, ((size.x - chamfer) - (p.x - p.y)) * 0.70710678);
    float a = clamp(d * pxScale + 0.5, 0.0, 1.0);
    if (stroke > 0.0) a *= clamp((stroke - d) * pxScale + 0.5, 0.0, 1.0);
    if (stripes > 0.0) {
      // Faixas diagonais de largura "stripes", alternando cor e vazio.
      float u = (p.x + p.y) * 0.70710678;
      float q = mod(u, stripes * 2.0) - stripes;
      a *= clamp((stripes * 0.5 - abs(q)) * pxScale + 0.5, 0.0, 1.0);
    }
    color.a *= a;
  } else if (vData0.x < 1.5) {
    color *= texture(atlas, vec3(vUv, layer));
  } else {
    // MSDF: mediana dos 3 canais; vData0.z = faixa de distância em px de tela.
    float sd = median3(texture(atlas, vec3(vUv, layer)).rgb) - 0.5;
    color.a *= clamp(sd * vData0.z + 0.5, 0.0, 1.0);
  }
  if (color.a <= 0.002) discard;
  fragColor = color;
}
`;
