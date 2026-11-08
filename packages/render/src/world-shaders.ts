// Programas do MUNDO do M1 (frente render-mundo): 1 blocos opacos, 2 blocos cutout, 3 translúcido (o mesmo código com
// `CUTOUT`/`TRANSLUCENT`) e 6 céu. GLSL ES 3.00 em `ShaderMaterial` com `glslVersion: GLSL3` (o three põe o
// `#version 300 es`, as precisões e as matrizes). Sem extensões, sem leitura de textura no vertex shader, fog e luz por
// uniform (Dia, Entardecer e Noite são só uniforms), variantes só por `#define` de criação (`ATLAS`, `VERTEX_FLOAT`).
// Os trechos comuns (luz, fog, LUT, cinza, vento, tabelas de normal, vértice compacto) vêm de `shared/glsl-common.ts`.
import {
  GLSL_BLOCK_VERTEX_INPUT,
  GLSL_COMMON_FRAGMENT,
  GLSL_COMMON_UNIFORMS,
  GLSL_COMMON_VERTEX,
  GLSL_NORMAL_TABLES,
} from './shared/glsl-common.ts';

/** Fatores de AO (0fps; nível 0 = canto mais fechado) aplicados à luz de céu e de sol. [PROPOSTA] até os prints. */
export const AO_LEVELS = [0.45, 0.64, 0.82, 1] as const;

/** Profundidade do céu em NDC (um fio antes do plano distante): só pinta o que nada cobriu. */
export const SKY_DEPTH = 0.999999;

const AO_GLSL = `float[4](${AO_LEVELS.map((v) => v.toFixed(2)).join(', ')})`;

/**
 * Vértice das regiões (programas 1–3). A UV é linear na posição dentro de cada face plana, então sai por vértice e o
 * interpolador entrega a mesma conta por pixel: `uv = vec2(dot(p, T), dot(p, B)) × 2` com p em metros de MUNDO (a
 * textura não "pula" entre regiões nem nas rampas). A luz (AO × (céu + sol × N·L) + emissivo) também sai por vértice:
 * as entradas variam linearmente pela face e o mesher já troca a diagonal do quad quando o AO pede.
 */
export const REGION_VERTEX = /* glsl */ `
${GLSL_COMMON_UNIFORMS}
${GLSL_NORMAL_TABLES}
${GLSL_COMMON_VERTEX}
${GLSL_BLOCK_VERTEX_INPUT}

// Bits das camadas-base de blocos16 com kind 'emissive' (brilho total, arte-ux.md §1.11): 256 bits em 2 ivec4.
uniform ivec4 uEmissiveLayers[2];

const float BF_AO_LEVELS[4] = ${AO_GLSL};

out vec3 vCell;       // posição em células, recuada meio texel pela normal (célula dona da face)
out vec3 vView;       // posição no espaço da câmera (distância da fog por pixel)
out vec2 vUv;         // UV contínua (repete a cada 0,5 m)
out vec3 vLight;      // luz final do vértice (AO, céu, sol × N·L, emissivo, clarão)
flat out vec4 vLayer; // camada base, variantes, quadros, bits (1 = randomUv, 2 = variação de cor)

bool bfEmissiveLayer(int layer) {
  // Índice CONSTANTE no array de uniform (regra 6, adendo do Eden): escolhe a palavra por ternário.
  ivec4 w = (layer >> 7) == 0 ? uEmissiveLayers[0] : uEmissiveLayers[1];
  int k = (layer >> 5) & 3;
  int bits = k == 0 ? w.x : (k == 1 ? w.y : (k == 2 ? w.z : w.w));
  return ((bits >> (layer & 31)) & 1) != 0;
}

void main() {
  BfBlockVertex v = bfUnpackBlockVertex(bfBlockData());
  vec3 n = BF_NORMALS[v.normal];
  // A modelMatrix da região leva o passo de 1/16 de célula a metros (escala 1/32) e soma a origem.
  vec4 world = modelMatrix * vec4(bfBlockPosition(), 1.0);
  vec3 p = world.xyz;
  vUv = vec2(dot(p, BF_TANGENTS[v.normal]), dot(p, BF_BITANGENTS[v.normal])) * 2.0;
  vCell = p * 2.0 - n * (1.0 / 32.0);
  // Só o vértice de cima da cruz balança: a UV e a célula ficam presas ao chão.
  if ((v.flags & BF_FLAG_SWAYS) != 0u && (v.flags & BF_FLAG_TOP) != 0u) world.xyz += bfWindOffset(p, 1.0);
  vec4 view = viewMatrix * world;
  vView = view.xyz;
  gl_Position = projectionMatrix * view;

  float ao = BF_AO_LEVELS[int(v.ao * 3.0 + 0.5)];
  // Emissivos pulsam devagar (microanimação, arte-ux.md §1.7), defasados pela posição.
  float pulse = 0.95 + 0.05 * sin(uTime * 1.3 + p.x * 0.37 + p.z * 0.21);
  vec3 light = bfSceneLight(n, ao, v.sky, v.sun, v.emissive * pulse);
  if (bfEmissiveLayer(int(v.layer))) light = max(light, vec3(1.0));
  vLight = light;
  float bits = ((v.flags & BF_FLAG_RANDOM_UV) != 0u ? 1.0 : 0.0) + (v.variation ? 2.0 : 0.0);
  vLayer = vec4(v.layer, v.variants, v.frames, bits);
}
`;

/**
 * Pixel das regiões. Rota array: `texture()` direto (REPEAT na camada). Rota `ATLAS`: `fract` + `textureGrad` com as
 * derivadas da UV contínua. Materiais com `randomUv` giram/espelham a UV por célula e amostram com as derivadas da UV
 * contínua (sem costura de mip na borda da célula). Fim: fog → LUT → cinza (`bfFinish`).
 */
export const REGION_FRAGMENT = /* glsl */ `
${GLSL_COMMON_UNIFORMS}
${GLSL_COMMON_FRAGMENT}

uniform BF_LAYER_SAMPLER uBlocks;
uniform vec4 uBlocksAtlas;
uniform vec2 uBlocksAtlasSize;

in vec3 vCell;
in vec3 vView;
in vec2 vUv;
in vec3 vLight;
flat in vec4 vLayer;

layout(location = 0) out vec4 fragColor;

// Gira (quartos de volta) e espelha a UV dentro da célula pelo hash dela (materiais contínuos).
vec2 bfRotateUv(vec2 uv, uint h) {
  vec2 f = fract(uv);
  if ((h & 4u) != 0u) f.x = 1.0 - f.x;
  uint r = h & 3u;
  if (r == 1u) f = vec2(f.y, 1.0 - f.x);
  else if (r == 2u) f = vec2(1.0 - f.x, 1.0 - f.y);
  else if (r == 3u) f = vec2(1.0 - f.y, f.x);
  return f;
}

#ifdef ATLAS
vec4 bfSampleBlockGrad(vec2 uv, vec2 dx, vec2 dy, float layer) {
  vec2 corner = bfAtlasCorner(uBlocksAtlas, layer);
  vec2 k = vec2(uBlocksAtlas.z) / uBlocksAtlasSize;
  return textureGrad(uBlocks, (corner + fract(uv) * uBlocksAtlas.z) / uBlocksAtlasSize, dx * k, dy * k);
}
#else
vec4 bfSampleBlockGrad(vec2 uv, vec2 dx, vec2 dy, float layer) {
  return textureGrad(uBlocks, vec3(uv, layer), dx, dy);
}
#endif

void main() {
  uint bits = uint(vLayer.w + 0.5);
  float layer = bfBlockLayer(vLayer.x, vLayer.y, vLayer.z, vCell);
  // Derivadas fora de qualquer desvio (fluxo uniforme).
  vec2 dx = dFdx(vUv);
  vec2 dy = dFdy(vUv);
  vec4 albedo;
  if ((bits & 1u) != 0u) {
    albedo = bfSampleBlockGrad(bfRotateUv(vUv, bfHash(ivec3(floor(vCell)) + ivec3(7, 131, 17))), dx, dy, layer);
  } else {
#ifdef ATLAS
    albedo = bfSampleBlockGrad(vUv, dx, dy, layer);
#else
    albedo = texture(uBlocks, vec3(vUv, layer));
#endif
  }
#ifdef CUTOUT
  if (albedo.a < 0.5) discard;
#endif
  // Ruído de cor ±3% por célula (nunca no bake: não quebra o greedy meshing).
  float variation = (bits & 2u) != 0u ? mix(0.97, 1.03, bfHash01(vCell + vec3(31.0, 7.0, 113.0))) : 1.0;
  vec3 color = bfFinish(albedo.rgb * variation * vLight, length(vView));
#ifdef TRANSLUCENT
  fragColor = vec4(color, albedo.a);
#else
  fragColor = vec4(color, 1.0);
#endif
}
`;

/**
 * Céu (programa 6): um cubo em volta da câmera (só a rotação da vista), com a profundidade no plano distante. Desenhado
 * DEPOIS dos opacos com teste de profundidade: só pinta o que o cenário não cobriu (o early-z descarta o resto).
 */
export const SKY_VERTEX = /* glsl */ `
const float BF_SKY_DEPTH = ${SKY_DEPTH.toFixed(6)};

out vec3 vDir;

void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(p.xy, p.w * BF_SKY_DEPTH, p.w);
}
`;

/**
 * Céu procedural, sem textura: gradiente de 3 cores (zênite, horizonte = cor da fog, chão), halo e disco blocado do sol
 * (ou da lua à noite), estrelas por hash, nuvens blocadas que andam com o tempo e o anel de morros no horizonte. Os
 * "pixels" são ângulos fixos no mundo: o céu não cintila quando a câmera gira.
 */
export const SKY_FRAGMENT = /* glsl */ `
${GLSL_COMMON_UNIFORMS}
${GLSL_COMMON_FRAGMENT}

uniform vec3 uZenithColor;
uniform float uStars;       // 0 de dia, 1 à noite (acima de 0,5 o disco vira lua)
uniform float uCloudCover;  // 0 = sem nuvens

in vec3 vDir;

layout(location = 0) out vec4 fragColor;

const float BF_PI = 3.14159265;
// Lado angular do pixel do sol e da lua (rad).
const float BF_SKY_PIXEL = 0.0075;
// Passos do anel de morros na volta inteira (múltiplo dos períodos do ruído abaixo).
const float BF_RING_STEPS = 768.0;

float bfCellNoise(ivec3 c) {
  return float(bfHash(c) & 1023u) / 1023.0;
}

// Ruído de valor 2D: hash nos cantos inteiros, interpolação suave.
float bfValueNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  ivec3 c = ivec3(int(i.x), int(i.y), 11);
  float a = bfCellNoise(c);
  float b = bfCellNoise(c + ivec3(1, 0, 0));
  float d = bfCellNoise(c + ivec3(0, 1, 0));
  float e = bfCellNoise(c + ivec3(1, 1, 0));
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}

// Ruído de valor 1D periódico: o anel fecha a volta sem degrau.
float bfValueNoise1(float x, float period, int salt) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = bfCellNoise(ivec3(int(mod(i, period)), salt, 5));
  float b = bfCellNoise(ivec3(int(mod(i + 1.0, period)), salt, 5));
  return mix(a, b, f);
}

vec3 bfSkyGradient(vec3 dir) {
  if (dir.y >= 0.0) return mix(uFogColor, uZenithColor, sqrt(dir.y));
  return mix(uFogColor, uGroundColor, clamp(-dir.y * 4.0, 0.0, 1.0));
}

float bfStars(vec3 dir) {
  if (uStars <= 0.0 || dir.y < 0.0) return 0.0;
  uint h = bfHash(ivec3(floor(dir * 160.0)) + ivec3(0, 0, 977));
  if ((h & 1023u) > 4u) return 0.0;
  float twinkle = 0.7 + 0.3 * sin(uTime * 2.3 + float((h >> 10u) & 255u));
  return twinkle * smoothstep(0.02, 0.25, dir.y) * uStars;
}

// Halo e disco blocado (octógono de pixels): sol 10×10, lua 8×8 com crateras.
vec3 bfSunMoon(vec3 color, vec3 dir, vec3 s) {
  float d = dot(dir, s);
  float night = step(0.5, uStars);
  color += uSunColor * (pow(max(d, 0.0), 48.0) * mix(0.45, 0.12, night));
  if (d < 0.95) return color;
  vec3 side = abs(s.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), s));
  vec3 up = cross(s, side);
  vec2 q = floor(vec2(dot(dir, side), dot(dir, up)) / BF_SKY_PIXEL);
  vec2 a = abs(q + 0.5);
  float r = mix(5.0, 4.0, night);
  if (max(a.x, a.y) > r || a.x + a.y > r * 1.5) return color;
  if (night > 0.5) {
    float crater = (bfHash(ivec3(int(q.x), int(q.y), 3)) & 7u) == 0u ? 0.8 : 1.0;
    return vec3(0.86, 0.88, 0.95) * crater;
  }
  float rim = (max(a.x, a.y) > r - 1.0 || a.x + a.y > r * 1.5 - 1.0) ? 0.0 : 1.0;
  return mix(uSunColor, vec3(1.0), 0.5 + 0.35 * rim);
}

// Nuvens blocadas: uma camada plana que anda com o tempo, cada célula cheia ou vazia, borda um tom abaixo do miolo.
vec3 bfClouds(vec3 color, vec3 dir) {
  if (uCloudCover <= 0.0 || dir.y <= 0.01) return color;
  vec2 p = dir.xz / dir.y * 10.0 + vec2(uTime * 0.07, uTime * 0.02);
  vec2 cell = floor(p);
  float density = bfValueNoise2(cell * 0.2) * 0.7 + bfValueNoise2(cell * 0.5 + 37.0) * 0.3;
  float threshold = 1.0 - uCloudCover;
  if (density < threshold) return color;
  float jitter = 0.97 + 0.06 * bfCellNoise(ivec3(int(cell.x), int(cell.y), 29));
  float core = density > threshold + 0.08 ? 1.0 : 0.86;
  vec3 lit = clamp(uSkyLightColor * uSkyStrength * 0.9 + uSunColor * uSunStrength * 0.8, 0.0, 1.0);
  return mix(color, lit * (core * jitter), smoothstep(0.01, 0.2, dir.y) * 0.95);
}

// Anel de silhueta: duas fileiras de morros blocados (a de longe mais apagada), para o mundo não terminar no vazio.
vec3 bfHorizonRing(vec3 color, vec3 dir) {
  float stepA = 2.0 * BF_PI / BF_RING_STEPS;
  float i = floor((atan(dir.z, dir.x) + BF_PI) / stepA);
  float elev = asin(clamp(dir.y, -1.0, 1.0));
  float farHill = 0.006 + 0.045 * bfValueNoise1(i / 24.0, BF_RING_STEPS / 24.0, 1)
    + 0.01 * bfValueNoise1(i / 6.0, BF_RING_STEPS / 6.0, 2);
  float nearHill = 0.002 + 0.02 * bfValueNoise1(i / 12.0, BF_RING_STEPS / 12.0, 3);
  farHill = floor(farHill / stepA) * stepA;
  nearHill = floor(nearHill / stepA) * stepA;
  if (elev < nearHill) return mix(uFogColor, uGroundColor, 0.55);
  if (elev < farHill) return mix(uFogColor, uGroundColor, 0.3);
  return color;
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 sky = bfSkyGradient(dir);
  sky += vec3(0.95, 0.96, 1.0) * bfStars(dir);
  sky = bfSunMoon(sky, dir, uSunDir);
  sky = bfClouds(sky, dir);
  sky = bfHorizonRing(sky, dir);
  fragColor = vec4(bfFinish(sky, 0.0), 1.0);
}
`;

/** Nomes dos uniforms próprios do céu (além dos comuns). */
export const SKY_UNIFORM_NAMES = ['uZenithColor', 'uStars', 'uCloudCover'] as const;
