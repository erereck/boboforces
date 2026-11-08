// Programa 4 (instanciado): bonecos (#56: uma instância por CAIXA do cubo unitário, 1 draw para todos), armas, props
// fora da grade, viewmodel, cubinhos de detrito e o desmonte. UM programa só: tudo que muda é atributo (vértice ou
// instância) ou uniform da vista. Regras (tecnico.md §6.5 e §21.6): sem extensão, sem textura no vertex shader, fog e
// luz por uniform. Camadas de `modelos64` (array ou atlas, `#define ATLAS`). Sem contorno de time (decisão #50).
//
// Caixa do boneco (vértice com `BF_V_BOX`, PLANO do porte §B10): a matriz da instância é a do OSSO (px → mundo) e a
// 4ª linha dela leva (céu, sol, emissivo, 2·expressão + clarão); a forma afim nunca usa essa linha. Centro, tamanho,
// giro próprio (Rx·Rz com cos/sen da CPU) e a UV da cruz (canto e medidas em texels, coeficientes no `uv` do cubo) vêm
// dos dados da instância (`FIGURE_INST`). O rosto é a face da frente da cabeça: a UV desloca para a célula da
// expressão. Instância que não é caixa (props, armas, viewmodel, cubinhos): 4ª linha 0 0 0 1, camada do vértice ou da
// instância, luz e cor dos dados.
//
// Restrições do Eden (recompilador de shader do emulador e do console): só `int(x + 0.5)`, `&` e soma de bits
// disjuntos (sem `|`), sem multiplicação/divisão/resto inteiros, divisão em float só no padrão `floor((x + 0.5) / n)`
// com o resto por subtração, sem `return` antes do fim do `main`, sem índice dinâmico em uniform, sem textura aqui.
//
// O bobo A (folha de rostos 8×8, desmonte por `iPart.x`, camada externa por `iPart.y` e a skin de 4 camadas por
// `aVert.x` = −1 − k) saiu no passo 5 do porte.
import { FIGURE_BOX_FLAG } from '@boboforces/format';
import { GLSL_COMMON_FRAGMENT, GLSL_COMMON_UNIFORMS, GLSL_COMMON_VERTEX } from '../shared/glsl-common.ts';
import { VERTEX_FLAG } from './layout.ts';

/** Uniforms próprios do programa 4 (além dos comuns e dos de textura `uModels*`). */
export const INSTANCED_UNIFORM_NAMES = ['uHideSlot', 'uOuterMaxDist'] as const;

const FLAG_DEFINES = /* glsl */ `
const int BF_V_ALPHA = ${VERTEX_FLAG.alphaTest};
const int BF_V_FACE = ${VERTEX_FLAG.face};
const int BF_V_BOX = ${VERTEX_FLAG.box};
const int BF_V_SOLID = ${VERTEX_FLAG.solid};
const int BF_V_EMISSIVE = ${VERTEX_FLAG.emissive};
const int BF_B_OUTER = ${FIGURE_BOX_FLAG.outer};
const int BF_B_FACE = ${FIGURE_BOX_FLAG.face};
`;

export const INSTANCED_VERTEX = /* glsl */ `
${GLSL_COMMON_UNIFORMS}
${GLSL_COMMON_VERTEX}
${FLAG_DEFINES}
// --- programa 4: instanciado (render-atores, actors/shader.ts) ---
in vec4 aVert;   // camada do vértice (>= 0) ou -1 (camada da instância), flags, balanço, livre
in vec4 iLayer;  // caixa: camada, u0 + 64·v0, w + 64·h + 4096·d, slot · outros: camada, 0, 0, slot
in vec4 iLight;  // caixa: centro no osso (px), flags da caixa · outros: céu, sol, emissivo, flash de dano
in vec4 iColor;  // caixa: cos rotX, sen rotX, cos rotZ, sen rotZ · outros: cor sólida (detrito), time (sem uso)
in vec4 iPart;   // caixa: tamanho (px) · outros: sem uso

uniform float uHideSlot;      // slot da vista em 1ª pessoa (-1 = ninguém): o próprio corpo some
uniform float uOuterMaxDist;  // além disso a camada externa colapsa (perfil; arte-ux.md §1.12)

out vec2 vUv;
flat out float vLayer;
flat out float vFlags;
out vec3 vNormal;
flat out vec4 vLight;
flat out vec3 vColor;
out float vDist;

void main() {
  int flags = int(aVert.y + 0.5);
  bool box = (flags & BF_V_BOX) != 0;
  int bflags = box ? int(iLight.w + 0.5) : 0;
  // O fragment vê, da caixa, só o recorte por alfa e o emissivo (bits disjuntos: soma, sem OR).
  vFlags = box ? float(bflags & (BF_V_ALPHA + BF_V_EMISSIVE)) : aVert.y;
  vUv = uv;
  vLayer = 0.0;
  vColor = iColor.rgb;

  // 4ª linha da matriz da caixa: céu, sol, emissivo e 2·expressão + clarão (actors/figure-row4.ts).
  mat4 im = instanceMatrix;
  float w4 = im[3][3];
  float expr = box ? floor(w4 * 0.5 + 0.001) : 0.0;
  vLight = box ? vec4(im[0][3], im[1][3], im[2][3], w4 - 2.0 * expr) : iLight;

  // Giro próprio da caixa (pontas de cabelo): R = Rx·Rz, na posição e na normal.
  vec3 q = position * iPart.xyz;
  vec3 r = vec3(iColor.z * q.x - iColor.w * q.y, iColor.w * q.x + iColor.z * q.y, q.z);
  r = vec3(r.x, iColor.x * r.y - iColor.y * r.z, iColor.y * r.y + iColor.x * r.z);
  vec3 nb = vec3(iColor.z * normal.x - iColor.w * normal.y, iColor.w * normal.x + iColor.z * normal.y, normal.z);
  nb = vec3(nb.x, iColor.x * nb.y - iColor.y * nb.z, iColor.y * nb.y + iColor.x * nb.z);
  vec3 lp = box ? iLight.xyz + r : position;
  vec3 ln = box ? nb : normal;

  // Forma afim: a 4ª linha da instância nunca entra (nas caixas ela leva dados; nos outros é 0 0 0 1).
  vec4 world = modelMatrix * vec4(mat3(im) * lp + im[3].xyz, 1.0);
  world.xyz += bfWindOffset(world.xyz, aVert.z);
  vNormal = normalize(mat3(modelMatrix) * (mat3(im) * ln));
  vDist = length(world.xyz - cameraPosition);

  bool hidden = abs(iLayer.w - uHideSlot) < 0.5;
  // Caixa com a flag outer (camada por cima) colapsa de longe.
  bool outer = box && (bflags & BF_B_OUTER) != 0;
  if (outer && vDist > uOuterMaxDist) hidden = true;

  // Escondido: fora do volume de recorte, o triângulo some sem custo de fragmento. Sem return no meio do main
  // (integração do M1): o recompilador de shader do Eden derruba o app com saída antecipada; vira if/else.
  vec4 clip = vec4(2.0, 2.0, 2.0, 1.0);
  if (!hidden) {
    // Camada: do vértice (modelo) ou da instância (skin do dono nos braços do viewmodel).
    float layer = aVert.x >= 0.0 ? aVert.x : iLayer.x;
    vec2 st = uv;
    if (box) {
      // UV da cruz: u = u0 + aw·w + ad·d e v = v0 + bh·h + bd·d, com uv = (aw + 3·ad, bh + 3·bd) no cubo. Tudo
      // empacotado em inteiros exatos no float e desempacotado no padrão do Eden (floor((x + 0.5) / n), resto por
      // subtração).
      float v0 = floor((iLayer.y + 0.5) / 64.0);
      float u0 = iLayer.y - v0 * 64.0;
      float dd = floor((iLayer.z + 0.5) / 4096.0);
      float rr = iLayer.z - dd * 4096.0;
      float dh = floor((rr + 0.5) / 64.0);
      float dw = rr - dh * 64.0;
      float ad = floor((uv.x + 0.5) / 3.0);
      float bd = floor((uv.y + 0.5) / 3.0);
      vec2 t = vec2(u0 + (uv.x - 3.0 * ad) * dw + ad * dd, v0 + (uv.y - 3.0 * bd) * dh + bd * dd);
      // Medida 0 (amostra de paleta, coluna de listra): lê o centro do texel.
      t += 0.5 * vec2(step(dw + dd, 0.5), step(dh + dd, 0.5));
      // Rosto: a frente da cabeça (16, 16) vai para a célula da expressão e, em (16·(e mod 4), 32 + 16·floor(e / 4)).
      float hi = step(3.5, expr);
      bool faceV = (bflags & BF_B_FACE) != 0 && (flags & BF_V_FACE) != 0;
      t += faceV ? vec2(16.0 * (expr - 4.0 * hi) - 16.0, 16.0 + 16.0 * hi) : vec2(0.0);
      st = t * 0.015625;
      layer = iLayer.x;
    }
    vUv = st;
    vLayer = layer;
    clip = projectionMatrix * viewMatrix * world;
  }
  gl_Position = clip;
}
`;

export const INSTANCED_FRAGMENT = /* glsl */ `
${GLSL_COMMON_UNIFORMS}
${GLSL_COMMON_FRAGMENT}
${FLAG_DEFINES}
// --- programa 4: instanciado (render-atores, actors/shader.ts) ---
uniform BF_LAYER_SAMPLER uModels;
uniform vec4 uModelsAtlas;
uniform vec2 uModelsAtlasSize;

in vec2 vUv;
flat in float vLayer;
flat in float vFlags;
in vec3 vNormal;
flat in vec4 vLight;
flat in vec3 vColor;
in float vDist;

layout(location = 0) out vec4 fragColor;

void main() {
  int flags = int(vFlags + 0.5);
  // Amostra antes de qualquer desvio (as derivadas do atlas precisam de fluxo uniforme).
  vec4 tex = bfSampleClamp(uModels, uModelsAtlas, uModelsAtlasSize, vUv, vLayer);
  if ((flags & BF_V_ALPHA) != 0 && tex.a < 0.5) discard;
  // Cubinho: cor sólida da instância sobre branco (não amostra a camada).
  vec3 albedo = (flags & BF_V_SOLID) != 0 ? vColor : tex.rgb;
  vec3 light = (flags & BF_V_EMISSIVE) != 0 ? vec3(1.0) : bfInstanceLight(normalize(vNormal), vLight.xyz);
  vec3 color = albedo * light;
  // Piscada branca do dano (arte-ux.md §2.5).
  color = mix(color, vec3(1.0), clamp(vLight.w, 0.0, 1.0) * 0.75);
  fragColor = vec4(bfFinish(color, vDist), 1.0);
}
`;
