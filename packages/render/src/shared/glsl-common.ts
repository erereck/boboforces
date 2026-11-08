// Trechos GLSL ES 3.00 COMUNS aos programas do mundo (1–3 blocos, 6 céu: frente "render-mundo"; 4 instanciado e
// 5 partículas: frente "render-atores"). CONTRATO CONGELADO do M1: nenhuma das duas frentes edita este arquivo; mudança
// vai em "Pedidos de contrato" (docs/ARCHITECTURE.md §8). Sem three aqui (só texto), então dá para testar em Node.
//
// Regras (tecnico.md §6.5 e §21.6): WebGL2 puro, sem `#extension`, sem leitura de textura no vertex shader, fog e luz
// por uniform (Dia, Entardecer e Noite são só uniforms), no máximo 7 programas: variantes só por `#define` de criação
// (`ATLAS`, `VERTEX_FLOAT`), nunca por chave de depuração (essas são uniforms).
//
// Os programas usam `ShaderMaterial` com `glslVersion: GLSL3` (o three põe `#version 300 es`, as precisões e as
// matrizes `modelMatrix`/`viewMatrix`/`projectionMatrix`). Cada programa declara o próprio `out vec4 fragColor`.
//
// Ordem de inclusão:
//   vertex:   GLSL_DEFINES_DOC (nada) · GLSL_COMMON_UNIFORMS · GLSL_NORMAL_TABLES · GLSL_COMMON_VERTEX
//             (+ GLSL_BLOCK_VERTEX_INPUT nos programas de bloco)
//   fragment: GLSL_COMMON_UNIFORMS · GLSL_NORMAL_TABLES (se usar) · GLSL_COMMON_FRAGMENT
import { BITANGENT_TABLE, NORMAL_TABLE, TANGENT_TABLE } from '@boboforces/world';

/** `#define`s de criação (vão no `defines` do material; mudam o programa, por isso só na criação do renderer). */
export const GLSL_DEFINE = {
  /** Plano B do T0: atlas 2D com padding em vez de `sampler2DArray` (`RendererOptions.textureMode = 'atlas'`). */
  atlas: 'ATLAS',
  /** Atributos do vértice compacto como float (`RendererOptions.vertexAttributes = 'float'`). */
  vertexFloat: 'VERTEX_FLOAT',
  /** Programa 2 (blocos cutout): `discard` com alfa < 0,5. */
  cutout: 'CUTOUT',
  /** Programa 3 (translúcido). */
  translucent: 'TRANSLUCENT',
} as const;

/**
 * Uniforms que TODO programa do mundo declara (os objetos `{ value }` são os mesmos em todos os materiais:
 * `SharedUniforms` em `passes.ts`). Nomes fixos: o render-mundo atualiza 1x por frame/vista e os passes só leem.
 */
export const COMMON_UNIFORM_NAMES = [
  'uSunDir',
  'uSunColor',
  'uSkyLightColor',
  'uGroundColor',
  'uEmissiveColor',
  'uFogColor',
  'uSunStrength',
  'uSkyStrength',
  'uFogNear',
  'uFogFar',
  'uTime',
  'uFlash',
  'uWind',
  'uGrayscale',
  'uGradeLut',
  'uGradeStrength',
] as const;

export const GLSL_COMMON_UNIFORMS = /* glsl */ `
// --- uniforms comuns (glsl-common.ts) ---
uniform vec3 uSunDir;          // direção PARA o sol (unitária), do mapa
uniform vec3 uSunColor;
uniform vec3 uSkyLightColor;   // cor da luz de céu
uniform vec3 uGroundColor;     // hemisfério de baixo
uniform vec3 uEmissiveColor;
uniform vec3 uFogColor;        // = horizonte do céu
uniform float uSunStrength;
uniform float uSkyStrength;
uniform float uFogNear;        // metros
uniform float uFogFar;         // metros (= alcance de visão = plano distante)
uniform float uTime;           // segundos (nuvens, vento, texturas animadas)
uniform float uFlash;          // 0..1: clarão de tiro na luz ambiente da vista
uniform float uWind;           // 0..1: vento na vegetação
uniform float uGrayscale;      // 0 ou 1 (print de leitura em cinza)
uniform sampler2D uGradeLut;   // LUT 1D de 256×1 RGBA8 (color grading da hora do dia)
uniform float uGradeStrength;  // 0..1
`;

function vec3List(table: readonly (readonly [number, number, number])[]): string {
  return table.map((v) => `vec3(${v.map((c) => (Math.abs(c) < 1e-9 ? 0 : c).toFixed(6)).join(', ')})`).join(',\n  ');
}

/** Quantas normais o vértice compacto usa (`NORMAL.count` do world). */
export const GLSL_NORMAL_COUNT = NORMAL_TABLE.length;

/**
 * Tabelas de normal, tangente e bitangente do vértice compacto (geradas das tabelas do world: nunca saem de sincronia).
 * UV de bloco: `uv = vec2(dot(p, T), dot(p, B)) * 2.0` com p em metros.
 */
export const GLSL_NORMAL_TABLES = /* glsl */ `
// --- tabela de normais do vértice compacto (world/src/mesh/vertex.ts) ---
const int BF_NORMAL_COUNT = ${GLSL_NORMAL_COUNT};
const vec3 BF_NORMALS[${GLSL_NORMAL_COUNT}] = vec3[${GLSL_NORMAL_COUNT}](
  ${vec3List(NORMAL_TABLE)}
);
const vec3 BF_TANGENTS[${GLSL_NORMAL_COUNT}] = vec3[${GLSL_NORMAL_COUNT}](
  ${vec3List(TANGENT_TABLE)}
);
const vec3 BF_BITANGENTS[${GLSL_NORMAL_COUNT}] = vec3[${GLSL_NORMAL_COUNT}](
  ${vec3List(BITANGENT_TABLE)}
);
`;

/** Funções que valem nos dois estágios (sem textura). */
const SHARED_FUNCTIONS = /* glsl */ `
// Hash da célula em 0..1 SÓ com conta de float ("hash without sine": o seno de argumento grande perde precisão em GPU
// de celular). Nada de multiplicação inteira: o recompilador de shader do Eden não implementa IMUL com registrador
// (integração do M1: os programas do cenário e do céu falhavam no emulador); as células do mapa (< 2048) cabem no
// float com folga.
float bfHashF(ivec3 c) {
  vec3 p = fract(vec3(c) * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// Luz do cenário (tecnico.md §6.4): AO escurece só céu e sol; o emissivo não passa pelo AO; o clarão soma ambiente.
// n: normal unitária em mundo; ao, sky, sun, emissive em 0..1. O céu tem um PISO de 1 nível (1/15): interior fechado
// fica escuro, nunca preto puro (arte-ux.md §1.3 reserva o preto para pupilas e frestas; verificação do M1).
const float BF_SKY_FLOOR = 0.0667;
vec3 bfSceneLight(vec3 n, float ao, float sky, float sun, float emissive) {
  vec3 hemi = mix(uGroundColor, uSkyLightColor, n.y * 0.5 + 0.5);
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 lit = ao * (max(sky, BF_SKY_FLOOR) * uSkyStrength * hemi + sun * uSunStrength * ndl * uSunColor);
  return lit + emissive * uEmissiveColor + uFlash * 0.35 * hemi;
}

// Atores, props e detritos: a mesma fórmula com a luz amostrada da grade de 2 m (sem AO por vértice).
vec3 bfInstanceLight(vec3 n, vec3 skySunEmissive) {
  return bfSceneLight(n, 1.0, skySunEmissive.x, skySunEmissive.y, skySunEmissive.z);
}

// Balanço da vegetação e das props com swaysInWind (só o topo mexe: 'amount' 0 na base, 1 no topo).
vec3 bfWindOffset(vec3 worldPos, float amount) {
  float t = uTime * 1.7 + worldPos.x * 0.6 + worldPos.z * 0.4;
  return vec3(sin(t), 0.0, cos(t * 0.8)) * (0.04 * uWind * amount);
}
`;

export const GLSL_COMMON_VERTEX = /* glsl */ `
// --- funções comuns do vertex shader (glsl-common.ts): nenhuma lê textura (regra 6) ---
${SHARED_FUNCTIONS}
`;

/**
 * Entrada do vértice compacto de 12 bytes (programas 1–3). `aPos` = palavras 0..2, `aData` = palavras 3..5
 * (`world/src/mesh/region.ts`). Rota inteira: `uvec3` (`vertexAttribIPointer`). Rota `VERTEX_FLOAT`: `vec3` com o
 * valor inteiro do u16 (não normalizado), convertido aqui.
 */
export const GLSL_BLOCK_VERTEX_INPUT = /* glsl */ `
// --- vértice compacto de 12 bytes (glsl-common.ts) ---
#ifdef VERTEX_FLOAT
in vec3 aPos;
in vec3 aData;
vec3 bfBlockPosition() { return aPos; }
uvec3 bfBlockData() { return uvec3(aData + 0.5); }
#else
in uvec3 aPos;
in uvec3 aData;
vec3 bfBlockPosition() { return vec3(aPos); }
uvec3 bfBlockData() { return aData; }
#endif

struct BfBlockVertex {
  int normal;        // índice em BF_NORMALS
  float ao;          // 0..1 (0 = canto mais fechado, 1 = aberto)
  bool variation;    // ruído de cor ±3% por célula
  float layer;       // camada BASE em blocos16
  float sky;         // 0..1
  float sun;         // 0..1
  float emissive;    // 0..1
  uint flags;        // REGION_VERTEX_FLAG
  float variants;    // 1..16
  float frames;      // 1..16
};

BfBlockVertex bfUnpackBlockVertex(uvec3 d) {
  BfBlockVertex v;
  v.normal = int(min(d.x & 31u, uint(BF_NORMAL_COUNT - 1)));
  v.ao = float((d.x >> 5u) & 3u) / 3.0;
  v.variation = ((d.x >> 7u) & 1u) == 1u;
  v.layer = float((d.x >> 8u) & 255u);
  v.sky = float(d.y & 15u) / 15.0;
  v.sun = float((d.y >> 4u) & 15u) / 15.0;
  v.emissive = float((d.y >> 8u) & 15u) / 15.0;
  v.flags = (d.y >> 12u) & 15u;
  v.variants = float(d.z & 15u) + 1.0;
  v.frames = float((d.z >> 4u) & 15u) + 1.0;
  return v;
}

// Bits de BfBlockVertex.flags (REGION_VERTEX_FLAG).
const uint BF_FLAG_ANIMATED = 1u;
const uint BF_FLAG_SWAYS = 2u;
const uint BF_FLAG_RANDOM_UV = 4u;
const uint BF_FLAG_TOP = 8u;
`;

export const GLSL_COMMON_FRAGMENT = /* glsl */ `
// --- funções comuns do fragment shader (glsl-common.ts) ---
${SHARED_FUNCTIONS}

// Só no fragment: nenhum vertex shader chama estes, e o '|' em uint do bfHash fica fora do texto que o recompilador
// do Eden vê no VS (PLANO do porte §B10, E.8; passo 5).
// 24 bits para quem tira bits (giro da UV, estrelas, crateras): só AND e deslocamento depois. Cada byte sai dos bits
// ALTOS de um bfHashF com outra semente: o fract de um produto na casa dos milhares só tem ~10 bits bons, então os bits
// baixos de uint(bfHashF * 2^24) eram quase sempre zero (medições do M1: estrelas e nuvens viravam chiado no céu).
uint bfHash(ivec3 c) {
  uint a = uint(bfHashF(c) * 256.0);
  uint b = uint(bfHashF(c + ivec3(91, 17, 53)) * 256.0);
  uint d = uint(bfHashF(c + ivec3(37, 113, 7)) * 256.0);
  return a | (b << 8u) | (d << 16u);
}

float bfHash01(vec3 p) {
  return bfHashF(ivec3(floor(p)));
}

// Camada final de bloco: base + variante sorteada pela célula + quadro da animação (BLOCK_ANIMATION_FPS = 4).
// 'cell' = célula dona da face (posição recuada meio texel pela normal, em células).
float bfBlockLayer(float base, float variants, float frames, vec3 cell) {
  float variant = variants > 1.0 ? min(variants - 1.0, floor(bfHashF(ivec3(floor(cell))) * variants)) : 0.0;
  float frame = frames > 1.0 ? mod(floor(uTime * 4.0), frames) : 0.0;
  return base + variant * frames + frame;
}

// Fog linear na cor do horizonte.
vec3 bfFog(vec3 color, float dist) {
  float f = clamp((dist - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);
  return mix(color, uFogColor, f);
}

// Color grading por LUT 1D (256 px; cada canal lê o seu).
vec3 bfGrade(vec3 color) {
  if (uGradeStrength <= 0.0) return color;
  vec3 c = clamp(color, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0;
  vec3 graded = vec3(
    texture(uGradeLut, vec2(c.r, 0.5)).r,
    texture(uGradeLut, vec2(c.g, 0.5)).g,
    texture(uGradeLut, vec2(c.b, 0.5)).b
  );
  return mix(color, graded, uGradeStrength);
}

vec3 bfGrayscale(vec3 color) {
  float y = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(color, vec3(y), uGrayscale);
}

// Fim de todo programa do mundo: fog → grading → cinza. 'dist' = distância da câmera em metros.
vec3 bfFinish(vec3 color, float dist) {
  return bfGrayscale(bfGrade(bfFog(color, dist)));
}

// --- amostragem de camada: TEXTURE_2D_ARRAY (padrão) ou atlas com padding (plano B, #define ATLAS) ---
// Atlas: 'grid' = (colunas, linhas, lado do tile em px, padding em px); 'atlasSize' = (largura, altura) em px. O mip
// usa as derivadas do UV contínuo (textureGrad), para não aparecer costura na repetição.
#ifdef ATLAS
#define BF_LAYER_SAMPLER sampler2D
// A divisão em float da GPU pode errar até 2,5 ULP (GLSL ES 3.00): 'floor(layer / cols)' com 'layer' múltiplo de
// 'cols' cai na linha de cima em algumas GPUs (visto na Intel UHD/ANGLE com 7 e 13 colunas). O +0,5 dá margem de
// 0,5/cols no quociente, e a coluna sai da linha, sem 'mod' (layer chega como inteiro exato em float).
vec2 bfAtlasCorner(vec4 grid, float layer) {
  float row = floor((layer + 0.5) / grid.x);
  float col = layer - row * grid.x;
  return vec2(col, row) * (grid.z + 2.0 * grid.w) + grid.w;
}
// Blocos: UV repete (fract), como o REPEAT do array.
vec4 bfSampleRepeat(sampler2D tex, vec4 grid, vec2 atlasSize, vec2 uv, float layer) {
  vec2 corner = bfAtlasCorner(grid, layer);
  vec2 st = (corner + fract(uv) * grid.z) / atlasSize;
  return textureGrad(tex, st, dFdx(uv) * grid.z / atlasSize, dFdy(uv) * grid.z / atlasSize);
}
// Modelos: UV dentro da camada (0..1), presa meio texel para dentro.
vec4 bfSampleClamp(sampler2D tex, vec4 grid, vec2 atlasSize, vec2 uv, float layer) {
  vec2 corner = bfAtlasCorner(grid, layer);
  vec2 inner = clamp(uv, 0.5 / grid.z, 1.0 - 0.5 / grid.z);
  vec2 st = (corner + inner * grid.z) / atlasSize;
  return textureGrad(tex, st, dFdx(uv) * grid.z / atlasSize, dFdy(uv) * grid.z / atlasSize);
}
#else
#define BF_LAYER_SAMPLER sampler2DArray
vec4 bfSampleRepeat(sampler2DArray tex, vec4 grid, vec2 atlasSize, vec2 uv, float layer) {
  return texture(tex, vec3(uv, layer));
}
vec4 bfSampleClamp(sampler2DArray tex, vec4 grid, vec2 atlasSize, vec2 uv, float layer) {
  return texture(tex, vec3(uv, layer));
}
#endif
`;

/**
 * Nomes dos samplers e dos uniforms de atlas por array (os dois programas declaram os do array que usam):
 * `uniform BF_LAYER_SAMPLER uBlocks; uniform vec4 uBlocksAtlas; uniform vec2 uBlocksAtlasSize;` (blocos16) e
 * `uniform BF_LAYER_SAMPLER uModels; uniform vec4 uModelsAtlas; uniform vec2 uModelsAtlasSize;` (modelos64). Na rota
 * array os de atlas existem mas não são usados (o compilador descarta).
 */
export const TEXTURE_UNIFORM_NAMES = {
  blocks: { sampler: 'uBlocks', atlas: 'uBlocksAtlas', atlasSize: 'uBlocksAtlasSize' },
  models: { sampler: 'uModels', atlas: 'uModelsAtlas', atlasSize: 'uModelsAtlasSize' },
} as const;

/** Padding do atlas do plano B em px (tecnico.md §6.1: 4 px nos blocos; arte-ux.md §1.6 cita 2). */
export const ATLAS_PADDING = { blocos16: 4, modelos64: 4 } as const;
/**
 * Níveis de mip do atlas por array (o padding de 4 px permite 3: 4 → 2 → 1). Os modelos usam os 3 (decisão #51: com a
 * skin a 32 px/m, o nível 2 é a skin a 8 px/m, a mesma densidade de longe do array; com 2, o bobo a 50 m no 3–4P
 * cintilaria só na rota atlas). Os blocos ficam com 2, como no print aprovado.
 */
export const ATLAS_MAX_MIP_LEVELS = { blocos16: 2, modelos64: 3 } as const;
