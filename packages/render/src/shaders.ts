// Shaders GLSL ES 3.00 próprios (ShaderMaterial com glslVersion GLSL3), sem chunks do three. Regras (tecnico.md §6.5 e
// §21.6): WebGL2 puro, sem extensões, sem leitura de textura no vertex shader, fog e luz por uniform (dia, entardecer e
// noite são só uniforms). Os programas do M0 são 4 dos 7 do orçamento: blocos opacos, blocos cutout, translúcido e
// instanciado. O three injeta `position`, `normal`, `modelMatrix`, `viewMatrix`, `projectionMatrix` e, no
// InstancedMesh, `instanceMatrix`/`instanceColor`.

/** Uniforms de luz e fog compartilhados por todos os programas do mundo (objetos `{ value }` divididos entre materiais). */
const LIGHTING_UNIFORMS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uEmissiveColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
`;

/**
 * Luz do cenário (tecnico.md §6.4): albedo × (AO × (céu × hemisfério + sol × max(N·L, 0) × corSol) + emissivo ×
 * corEmissivo), depois fog linear pela distância. Pesos fixos para dia claro sem estourar o branco; o resto é uniform.
 */
const LIGHTING_FUNCTIONS = /* glsl */ `
const float SKY_WEIGHT = 0.85;
const float SUN_WEIGHT = 0.55;

vec3 sceneLight(vec3 n, float ao, float sky, float sun, float emissive) {
  vec3 hemi = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);
  float ndl = max(dot(n, uSunDir), 0.0);
  return ao * (sky * SKY_WEIGHT * hemi + sun * SUN_WEIGHT * ndl * uSunColor) + emissive * uEmissiveColor;
}

vec3 applyFog(vec3 color, float dist) {
  float f = clamp((dist - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);
  return mix(color, uFogColor, f);
}
`;

/**
 * Blocos (programas 1, 2 e 3: mesmo código, `CUTOUT` e `TRANSLUCENT` por define). O vértice compacto chega como
 * `position` (3 × u16, 1/16 de célula, convertido para float pelo GL; a escala até metros está na `modelMatrix`) e
 * `aAttr` (4 × u8 como float 0..255, ver `world/src/mesh/vertex.ts`). A UV sai da posição de mundo:
 * `uv = vec2(dot(p, T), dot(p, B)) × 2`, com T e B da tabela por normal; o wrap REPEAT da camada faz a textura repetir
 * a cada 0,5 m, então quads fundidos pelo greedy não esticam a textura.
 */
export const BLOCK_VERTEX = /* glsl */ `
in vec4 aAttr;

// Tabela de normais do mesher (índices 0..5 = FACE: +X, -X, +Y, -Y, +Z, -Z), com tangente (direita de quem olha a
// face de fora) e bitangente (para baixo na textura: a linha 0 do PNG fica em cima).
const vec3 NORMALS[6] = vec3[6](vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, -1, 0), vec3(0, 0, 1), vec3(0, 0, -1));
const vec3 TANGENTS[6] = vec3[6](vec3(0, 0, -1), vec3(0, 0, 1), vec3(1, 0, 0), vec3(1, 0, 0), vec3(1, 0, 0), vec3(-1, 0, 0));
const vec3 BITANGENTS[6] = vec3[6](vec3(0, -1, 0), vec3(0, -1, 0), vec3(0, 0, 1), vec3(0, 0, -1), vec3(0, -1, 0), vec3(0, -1, 0));

out vec3 vWorld;
out float vDist;
out vec3 vLight;
out float vAo;
flat out vec3 vNormal;
flat out vec3 vTangent;
flat out vec3 vBitangent;
flat out float vLayer;
flat out float vVariation;

void main() {
  uint a0 = uint(aAttr.x + 0.5);
  uint a2 = uint(aAttr.z + 0.5);
  uint a3 = uint(aAttr.w + 0.5);
  uint n = min(a0 & 31u, 5u);
  vNormal = NORMALS[n];
  vTangent = TANGENTS[n];
  vBitangent = BITANGENTS[n];
  // AO 0..3 (3 = canto aberto) vira fator 0,45..1.
  vAo = mix(0.45, 1.0, float((a0 >> 5u) & 3u) / 3.0);
  vVariation = float((a0 >> 7u) & 1u);
  vLayer = floor(aAttr.y + 0.5);
  vLight = vec3(float(a2 & 15u), float(a2 >> 4u), float(a3 & 15u)) / 15.0;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 view = viewMatrix * world;
  vDist = length(view.xyz);
  gl_Position = projectionMatrix * view;
}
`;

export const BLOCK_FRAGMENT = /* glsl */ `
uniform sampler2DArray uBlocks;
${LIGHTING_UNIFORMS}
${LIGHTING_FUNCTIONS}

in vec3 vWorld;
in float vDist;
in vec3 vLight;
in float vAo;
flat in vec3 vNormal;
flat in vec3 vTangent;
flat in vec3 vBitangent;
flat in float vLayer;
flat in float vVariation;

layout(location = 0) out vec4 fragColor;

// Hash inteiro da célula (sem seno: o seno de argumento grande perde precisão em GPU de celular).
float cellHash(vec3 p) {
  ivec3 c = ivec3(floor(p));
  uint h = uint(c.x) * 73856093u ^ uint(c.y) * 19349663u ^ uint(c.z) * 83492791u;
  h ^= h >> 13u;
  h *= 0x5bd1e995u;
  h ^= h >> 15u;
  return float(h & 1023u) / 1023.0;
}

void main() {
  vec2 uv = vec2(dot(vWorld, vTangent), dot(vWorld, vBitangent)) * 2.0;
  vec4 albedo = texture(uBlocks, vec3(uv, vLayer));
#ifdef CUTOUT
  if (albedo.a < 0.5) discard;
#endif
  // Variação de cor por célula (±3% de brilho), recuada meia célula pela normal para cair no bloco dono da face.
  float variation = vVariation > 0.5 ? mix(0.97, 1.03, cellHash(vWorld * 2.0 - vNormal * 0.5)) : 1.0;
  vec3 color = albedo.rgb * variation * sceneLight(vNormal, vAo, vLight.x, vLight.y, vLight.z);
  color = applyFog(color, vDist);
#ifdef TRANSLUCENT
  fragColor = vec4(color, albedo.a);
#else
  fragColor = vec4(color, 1.0);
#endif
}
`;

/**
 * Instanciado (programa 4): atores provisórios do M0, caixas de cor sólida por instância. `aExtra` = [flash de dano,
 * slot local dono]; a viewport do jogador em 1ª pessoa esconde o próprio corpo pelo uniform `uHideSlot` (um uniform por
 * viewport em vez de reenviar matrizes, tecnico.md §6.6). `aShade` escurece a face da frente da cabeça (mostra para
 * onde o bobo olha).
 */
export const ACTOR_VERTEX = /* glsl */ `
in vec2 aExtra;
in float aShade;
uniform float uHideSlot;

out vec3 vColor;
out vec3 vNormal;
out float vDist;
out float vFlash;

void main() {
  if (abs(aExtra.y - uHideSlot) < 0.5) {
    // Fora do volume de recorte: o triângulo some sem custo de fragmento.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec3(0.0);
    vNormal = vec3(0.0, 1.0, 0.0);
    vDist = 0.0;
    vFlash = 0.0;
    return;
  }
  vColor = instanceColor * aShade;
  vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vFlash = aExtra.x;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 view = viewMatrix * world;
  vDist = length(view.xyz);
  gl_Position = projectionMatrix * view;
}
`;

export const ACTOR_FRAGMENT = /* glsl */ `
${LIGHTING_UNIFORMS}
${LIGHTING_FUNCTIONS}

in vec3 vColor;
in vec3 vNormal;
in float vDist;
in float vFlash;

layout(location = 0) out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormal);
  vec3 color = vColor * sceneLight(n, 1.0, 1.0, 1.0, 0.0);
  color = mix(color, vec3(1.0), clamp(vFlash, 0.0, 1.0) * 0.7);
  fragColor = vec4(applyFog(color, vDist), 1.0);
}
`;
