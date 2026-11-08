// Programa 5 (partículas e quads): clarão, traçante, faíscas, confete, fumaça e poeira de cubos, marcas de tiro e
// sombra-blob. As partículas são SEM ESTADO na CPU depois de nascer: posição = p0 + v·t − ½·g·t², giro, tamanho e
// fade saem do relógio (`uFxTime`) no vertex shader. A CPU só escreve a instância ao nascer (upload só nos frames com
// efeito novo). As formas são desenhadas por conta no fragment shader (sem atlas de sprites), em "pixels" de 1/8.
import { GLSL_COMMON_FRAGMENT, GLSL_COMMON_UNIFORMS, GLSL_COMMON_VERTEX } from '../shared/glsl-common.ts';

/** Tipos de partícula (`pE.z`, bits 0..3; o slot dono + 1 vai em cima, ×16). */
export const PARTICLE_KIND = {
  /** Disco pixelado suave: brilho, poeira, fumaça. */
  round: 0,
  /** Quadrado: confete, fumaça de cubos, faísca parada. */
  square: 1,
  /** Faixa de p0 a p1 que viaja (traçante); `pB.x` = comprimento da faixa. */
  streak: 2,
  /** Faísca: faixa na direção da velocidade. */
  spark: 3,
  /** Marca de tiro: quad na superfície (normal em `pC`). */
  decal: 4,
  /** Sombra-blob: disco escuro no chão. */
  blob: 5,
  /** Clarão do cano: estrela de 4 pontas (2 quadros pelo giro). */
  star: 6,
} as const;

export const PARTICLE_UNIFORM_NAMES = ['uFxTime', 'uHideSlot', 'uAdditive'] as const;

const KIND_CONSTS = /* glsl */ `
const int BF_P_ROUND = 0;
const int BF_P_SQUARE = 1;
const int BF_P_STREAK = 2;
const int BF_P_SPARK = 3;
const int BF_P_DECAL = 4;
const int BF_P_BLOB = 5;
const int BF_P_STAR = 6;
`;

export const PARTICLE_VERTEX = /* glsl */ `
${GLSL_COMMON_UNIFORMS}
${GLSL_COMMON_VERTEX}
${KIND_CONSTS}
// --- programa 5: partículas (render-atores, fx/shader.ts) ---
in vec4 pA;  // x0, y0, z0, tamanho (m)
in vec4 pB;  // velocidade (m/s), gravidade (m/s², para baixo) | traçante: comprimento da faixa
in vec4 pC;  // fim do traçante | normal do decal, giro inicial (rad)
in vec4 pD;  // r, g, b, a
in vec4 pE;  // nascimento (s), vida (s), tipo + 16·(slot + 1), tamanho no fim / tamanho no começo
in vec4 pF;  // céu, sol, emissivo, giro (rad/s)

uniform float uFxTime;
uniform float uHideSlot;

out vec2 vLocal;
flat out int vKind;
out vec4 vColor;
flat out vec3 vLight;
out vec3 vNormal;
out float vDist;
out float vT;

void main() {
  vLocal = position.xy;
  vColor = pD;
  vLight = pF.xyz;
  vNormal = vec3(0.0, 1.0, 0.0);
  vDist = 0.0;
  vT = 0.0;
  float code = floor(pE.z + 0.5);
  int kind = int(mod(code, 16.0));
  float owner = floor(code / 16.0) - 1.0;
  vKind = kind;
  float age = uFxTime - pE.x;
  float t = age / max(pE.y, 1e-4);
  // Morta ou do dono escondido: fora do recorte. Sem return no meio do main (integração do M1: o recompilador de
  // shader do Eden derruba o app com saída antecipada).
  vec4 clip = vec4(2.0, 2.0, 2.0, 1.0);
  if (!(age < 0.0 || t >= 1.0 || (owner >= 0.0 && abs(owner - uHideSlot) < 0.5))) {
  vT = t;
  float size = pA.w * mix(1.0, pE.w, t);
  float rot = pC.w + pF.w * age;
  vec2 c = position.xy;
  vec2 rc = vec2(c.x * cos(rot) - c.y * sin(rot), c.x * sin(rot) + c.y * cos(rot));
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 pos = pA.xyz + pB.xyz * age - vec3(0.0, 0.5 * pB.w * age * age, 0.0);
  vec3 world;
  if (kind == BF_P_STREAK) {
    // Traçante: a cabeça vai de p0 a p1 durante a vida; a cauda vem atrás (comprimento pB.x).
    vec3 d = pC.xyz - pA.xyz;
    float len = length(d);
    vec3 dir = d / max(len, 1e-4);
    float head = len * t;
    float tail = max(0.0, head - pB.x);
    vec3 p = pA.xyz + dir * mix(tail, head, c.y + 0.5);
    vec3 side = normalize(cross(dir, cameraPosition - p) + vec3(1e-5, 0.0, 0.0));
    world = p + side * c.x * size;
  } else if (kind == BF_P_SPARK) {
    vec3 vel = pB.xyz - vec3(0.0, pB.w * age, 0.0);
    vec3 dir = normalize(vel + vec3(0.0, 1e-5, 0.0));
    vec3 p = pos - dir * (0.5 - (c.y + 0.5)) * size * 6.0;
    vec3 side = normalize(cross(dir, cameraPosition - p) + vec3(1e-5, 0.0, 0.0));
    world = p + side * c.x * size;
  } else if (kind == BF_P_DECAL || kind == BF_P_BLOB) {
    vec3 n = kind == BF_P_BLOB ? vec3(0.0, 1.0, 0.0) : normalize(pC.xyz + vec3(0.0, 1e-5, 0.0));
    vec3 t1 = normalize(cross(n, abs(n.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
    vec3 t2 = cross(n, t1);
    vNormal = n;
    world = pA.xyz + n * 0.004 + (t1 * rc.x + t2 * rc.y) * size;
  } else {
    vNormal = normalize(cameraPosition - pos);
    world = pos + (camRight * rc.x + camUp * rc.y) * size;
  }
  vDist = length(world - cameraPosition);
  clip = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
  gl_Position = clip;
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `
${GLSL_COMMON_UNIFORMS}
${GLSL_COMMON_FRAGMENT}
${KIND_CONSTS}
// --- programa 5: partículas (render-atores, fx/shader.ts) ---
uniform float uAdditive;  // 1 = material aditivo (clarão, traçante, faísca): sem luz, a fog apaga

in vec2 vLocal;
flat in int vKind;
in vec4 vColor;
flat in vec3 vLight;
in vec3 vNormal;
in float vDist;
in float vT;

layout(location = 0) out vec4 fragColor;

void main() {
  vec2 q = vLocal;
  // "Pixels" de 1/8 do quad: a partícula tem a mesma cara blocada do resto.
  vec2 pq = (floor((q + 0.5) * 8.0) + 0.5) / 8.0 - 0.5;
  float r = length(pq) * 2.0;
  vec3 color = vColor.rgb;
  float shape = 1.0;
  float fadeStart = 0.55;
  if (vKind == BF_P_ROUND) {
    shape = r < 0.95 ? 1.0 - r * r * 0.5 : 0.0;
  } else if (vKind == BF_P_SQUARE) {
    // Quadradinho com a borda um tom abaixo (lê como cubo).
    color *= max(abs(pq.x), abs(pq.y)) > 0.37 ? 0.8 : 1.0;
  } else if (vKind == BF_P_STREAK || vKind == BF_P_SPARK) {
    shape = (1.0 - abs(q.x) * 2.0) * (0.35 + 0.65 * (q.y + 0.5));
    fadeStart = 0.8;
  } else if (vKind == BF_P_DECAL) {
    // Marca de tiro: miolo escuro e anel chamuscado, em pixels de 1/8.
    if (r < 0.45) {
      color = vec3(0.07, 0.06, 0.05);
      shape = 0.95;
    } else if (r < 0.9) {
      color *= 0.55;
      shape = 0.65;
    } else {
      shape = 0.0;
    }
    fadeStart = 0.9;
  } else if (vKind == BF_P_BLOB) {
    // A sombra-blob vive "para sempre" (vT ~ 0): o fade só começa no fim. A borda 0 do smoothstep TEM de ficar abaixo
    // de 1,0 (com 2,0 o resultado é indefinido e, na prática, dava 1 → alfa 0 → discard: a sombra nunca aparecia).
    shape = floor(clamp(1.0 - r, 0.0, 1.0) * 4.0) / 4.0;
    fadeStart = 0.99;
  } else if (vKind == BF_P_STAR) {
    float ax = abs(q.x) * 2.0;
    float ay = abs(q.y) * 2.0;
    float star = max(1.0 - (ax * 4.0 + ay), 1.0 - (ay * 4.0 + ax));
    shape = clamp(max(star, 1.0 - r * 1.4), 0.0, 1.0);
    fadeStart = 0.5;
  }
  float alpha = vColor.a * shape * (1.0 - smoothstep(fadeStart, 1.0, vT));
  if (alpha <= 0.01) discard;
  if (uAdditive > 0.5) {
    // Aditivo: sem luz; a fog apaga o brilho em vez de pintar com a cor do horizonte (sem return antecipado: Eden).
    float f = clamp((vDist - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);
    fragColor = vec4(bfGrayscale(color), alpha * (1.0 - f));
  } else {
    if (vKind != BF_P_BLOB) color *= bfInstanceLight(normalize(vNormal), vLight);
    fragColor = vec4(bfFinish(color, vDist), alpha);
  }
}
`;
