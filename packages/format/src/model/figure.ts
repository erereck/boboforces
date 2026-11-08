/**
 * O boneco do FutBobo como bobo do BoboForces (decisão #56; PLANO do porte §B1–§B4 e §C1). CONTRATO congelado depois
 * do passo 2: a sim (hitboxes pela tabela de jogo), o render (instâncias e animação), a pintura e as ferramentas leem
 * daqui. Mudou um número: `figure.test.ts`, a tabela de jogo (F1) e a paridade hitbox × visual (E.1) acompanham.
 *
 * Unidade: o "px de boneco" do FutBobo. 1 px = `FIGURE_PX_M` = 7/128 m; o boneco tem 32 px (1,75 m) e 4 cabeças de 8.
 * Frame do boneco = frame do FutBobo: frente +z, +x = ESQUERDA do boneco, y para cima. É uma rotação do frame do BF
 * (frente −Z, +X = direita), não um espelho: a raiz leva `Ry(yaw + π)` e os ângulos do FutBobo entram sem trocar sinal.
 * Sinais (`Rx(a > 0)` leva +Y para +Z): membro pendurado com X > 0 vai para trás; `shX` < 0 levanta o braço à frente;
 * `hipX` < 0 leva a coxa à frente; `knee` > 0 dobra; `torsoX` > 0 inclina para a frente; `neckX` > 0 olha para baixo.
 */
import { FIGURE_LAYOUT, FIGURE_SWATCH, figureSwatchCorner } from './figure-layout.ts';

/** Altura do boneco em px (topo da cabeça na pose de repouso, sola em 0). */
export const FIGURE_HEIGHT_PX = 32;
/** Metros por px de boneco: 1,75 m / 32 px (fração binária exata). */
export const FIGURE_PX_M = 7 / 128;
/** Meia aresta da cabeça (8 px) em metros: 0,21875. */
export const FIGURE_HEAD_HALF_M = 4 * FIGURE_PX_M;
/**
 * Maior topo de hitbox em pé, em qualquer postura e pitch: o visual chega a 1,8016 e a hitbox, com a folga da
 * interpolação da tabela, a 1,80375 (sniper ADS, pitch 0,47; o `figure-table.test.ts` recalcula e exige ≤ isto e a
 * menos de 0,01).
 */
export const FIGURE_MAX_TOP_M = 1.81;
/** Maior topo de hitbox agachado ou deslizando (medido 0,969). */
export const FIGURE_CROUCH_TOP_M = 0.97;
/** Envelope das camadas cosméticas: cabeça e tronco a no máximo isto da pose base (px). */
export const FIGURE_ENVELOPE_PX = { regime: 1, peak: 2, peakMaxS: 0.3 } as const;

/** Ossos na ordem do BF: osso = parte de acerto = caixa primária = instância primária. */
export const FIGURE_BONE = {
  head: 0,
  torso: 1,
  upperArmR: 2,
  upperArmL: 3,
  forearmR: 4,
  forearmL: 5,
  thighR: 6,
  thighL: 7,
  shinR: 8,
  shinL: 9,
  footR: 10,
  footL: 11,
} as const;
export type FigureBone = (typeof FIGURE_BONE)[keyof typeof FIGURE_BONE];
export const FIGURE_BONES = 12;
/** Parte de acerto = osso (cubinho e dano usam o mesmo índice). */
export type FigurePart = FigureBone;
/** Categoria de dano por osso: 0 cabeça, 1 tronco, 2 braço, 3 perna (`HIT_PARTS` da sim). */
export const FIGURE_PART_CATEGORY: readonly (0 | 1 | 2 | 3)[] = [0, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3];
/** Pai de cada osso; −1 = `hips` (grupo acima dos ossos). A cabeça é filha do tronco, que vem depois dela. */
export const FIGURE_BONE_PARENT: readonly number[] = [1, -1, 1, 1, 2, 3, -1, -1, 6, 7, 8, 9];
/** Corpos do desmonte (cubinhos e cadáver). */
export const FIGURE_GROUP = { head: 0, torso: 1, armR: 2, armL: 3, legR: 4, legL: 5 } as const;
export const FIGURE_BONE_GROUP: readonly number[] = [0, 1, 2, 3, 2, 3, 4, 5, 4, 5, 4, 5];

/** Chaves da pose: as 31 do FutBobo (`character.ts:620-629`, mesma ordem) + 3 novas. */
export const FIGURE_POSE = {
  bodyX: 0,
  bodyY: 1,
  bodyZ: 2,
  bodyRotX: 3,
  bodyRotZ: 4,
  pivX: 5,
  pivZ: 6,
  spinY: 7,
  hipsY: 8,
  torsoX: 9,
  torsoY: 10,
  torsoZ: 11,
  neckX: 12,
  neckY: 13,
  neckZ: 14,
  shLX: 15,
  shLY: 16,
  shLZ: 17,
  shRX: 18,
  shRY: 19,
  shRZ: 20,
  elL: 21,
  elR: 22,
  hipLX: 23,
  hipLZ: 24,
  hipRX: 25,
  hipRZ: 26,
  kneeL: 27,
  kneeR: 28,
  ankleL: 29,
  ankleR: 30,
  /** px: o pescoço desce ao longo do tronco (agachar). */
  neckSink: 31,
  /** px: o tronco desce a partir de `hips` (só a alternativa PF do agachar, G4). */
  torsoSink: 32,
  /** px ao longo da FRENTE DA RAIZ (a direção da mira): cabeça presa ao olho. */
  neckSlide: 33,
} as const;
export const FIGURE_POSE_SIZE = 34;
type FigurePoseKey = keyof typeof FIGURE_POSE;

// --- Poses base (constantes congeladas; o figure.test.ts refaz cada fechamento) ---

/** Braço ESQUERDO de repouso do FutBobo (x, y, z, cotovelo; `character.ts:828`); o direito é o espelho (`putR`). */
const ARM_REST = [0, 0, 0.09, -0.14] as const;
/** Braços do zumbi: à frente, nos dois lados (PLANO §B4). */
const ARM_ZOMBIE = [-1.47, 0, 0.1, -0.1] as const;

function makePose(values: Readonly<Partial<Record<FigurePoseKey, number>>>, arm: readonly number[]): Float32Array {
  const pose = new Float32Array(FIGURE_POSE_SIZE);
  // `putL` e `putR` do FutBobo: o lado direito nega Y e Z.
  pose[FIGURE_POSE.shLX] = arm[0]!;
  pose[FIGURE_POSE.shLY] = arm[1]!;
  pose[FIGURE_POSE.shLZ] = arm[2]!;
  pose[FIGURE_POSE.elL] = arm[3]!;
  pose[FIGURE_POSE.shRX] = arm[0]!;
  pose[FIGURE_POSE.shRY] = -arm[1]!;
  pose[FIGURE_POSE.shRZ] = -arm[2]!;
  pose[FIGURE_POSE.elR] = arm[3]!;
  for (const [key, value] of Object.entries(values)) pose[FIGURE_POSE[key as FigurePoseKey]] = value;
  return pose;
}

/** Repouso do FutBobo (`stand` sem a respiração), braços `ARM_REST`, pernas retas e pé plano (tornozelo 0). */
export const FIGURE_REST_POSE: Float32Array = /* @__PURE__ */ makePose({}, ARM_REST);

/**
 * Agachado P4f (PLANO §B4): cócoras com o tronco a 0,65 e a cabeça na vertical, pescoço afundado 4 px, braços ao longo
 * do tronco (#55). `bodyY` = −legDrop(−2,0944; 0; 2,7053) = −9,17776, gravado como −9,1777 para a sola não descer de 0
 * (o −9,178 do plano é o mesmo número arredondado). Tornozelo = −canela (pé plano: |canela| < 0,7). `bodyZ` centra a
 * faixa z. Medido: topo 0,940 m, sola 0, meia faixa z 0,286 m.
 */
export const FIGURE_CROUCH_POSE: Float32Array = /* @__PURE__ */ makePose(
  {
    bodyY: -9.1777,
    bodyZ: -3.631,
    hipLX: -2.0944,
    hipRX: -2.0944,
    kneeL: 2.7053,
    kneeR: 2.7053,
    ankleL: -0.6109,
    ankleR: -0.6109,
    torsoX: 0.65,
    neckX: -0.65,
    neckSink: 4,
  },
  ARM_REST,
);

/**
 * Deslize "carrinho" (PLANO §B4): perna E esticada, D um pouco dobrada, tronco deitado para trás e cabeça reta, pescoço
 * afundado 4 px, `bodyZ` −1,3 px (centra a faixa z). Tornozelos pelo pé plano do FutBobo (`character.ts:4127-4134`):
 * E com a canela a −1,4 rad (peso 0, tornozelo 0); D a −1,2 rad (peso 0,0741, tornozelo +0,0889). Medido: topo 0,928 m.
 */
export const FIGURE_SLIDE_POSE: Float32Array = /* @__PURE__ */ makePose(
  {
    bodyY: -8,
    bodyZ: -1.3,
    hipLX: -1.5,
    kneeL: 0.1,
    hipRX: -1.6,
    kneeR: 0.4,
    ankleL: 0,
    ankleR: 0.0889,
    torsoX: -0.9,
    neckX: 0.9,
    neckSink: 4,
  },
  ARM_REST,
);

/** Zumbi (PLANO §B4): tronco curvado +0,35, braços à frente nos dois lados e pescoço −0,2; pernas retas. */
export const FIGURE_ZOMBIE_POSE: Float32Array = /* @__PURE__ */ makePose({ torsoX: 0.35, neckX: -0.2 }, ARM_ZOMBIE);

// --- Caixas ---

export const FIGURE_BOX_FLAG = { alphaTest: 1, emissive: 16, outer: 32, face: 64, hair: 128 } as const;
/** Campos de uma caixa de gabarito: centro e tamanho em px no espaço do osso, giro próprio, UV em texels, flags. */
export const FIGURE_BOX_FIELD = {
  bone: 0,
  cx: 1,
  cy: 2,
  cz: 3,
  sx: 4,
  sy: 5,
  sz: 6,
  rotX: 7,
  rotZ: 8,
  layer: 9,
  u: 10,
  v: 11,
  w: 12,
  h: 13,
  d: 14,
  flags: 15,
} as const;
export const FIGURE_BOX_STRIDE = 16;
/** Teto de caixas por gabarito: 14 do corpo + 28 de cabelo + braçadeira + 1 de folga. */
export const FIGURE_MAX_BOXES = 44;

function writeBox(
  out: Float32Array,
  i: number,
  bone: FigureBone,
  center: readonly number[],
  size: readonly number[],
  uv: {
    readonly layer: number;
    readonly u: number;
    readonly v: number;
    readonly w: number;
    readonly h: number;
    readonly d: number;
  },
  flags: number,
): void {
  const o = i * FIGURE_BOX_STRIDE;
  const F = FIGURE_BOX_FIELD;
  out[o + F.bone] = bone;
  out[o + F.cx] = center[0]!;
  out[o + F.cy] = center[1]!;
  out[o + F.cz] = center[2]!;
  out[o + F.sx] = size[0]!;
  out[o + F.sy] = size[1]!;
  out[o + F.sz] = size[2]!;
  out[o + F.rotX] = 0;
  out[o + F.rotZ] = 0;
  out[o + F.layer] = uv.layer;
  out[o + F.u] = uv.u;
  out[o + F.v] = uv.v;
  out[o + F.w] = uv.w;
  out[o + F.h] = uv.h;
  out[o + F.d] = uv.d;
  out[o + F.flags] = flags;
}

/** UV de uma amostra da paleta: caixa de medidas 0 com o canto da `figureSwatchCorner`. */
function swatchUv(i: number): { layer: number; u: number; v: number; w: number; h: number; d: number } {
  const corner = figureSwatchCorner(i);
  const u = corner % 64;
  return { layer: FIGURE_LAYOUT.palette.layer, u, v: (corner - u) / 64, w: 0, h: 0, d: 0 };
}

/** As 14 caixas do corpo: 12 primárias + mão D + mão E. */
const BODY_BOXES = 14;

function buildBodyBoxes(): Float32Array {
  const out = new Float32Array(BODY_BOXES * FIGURE_BOX_STRIDE);
  const B = FIGURE_BONE;
  const L = FIGURE_LAYOUT;
  const hand = swatchUv(FIGURE_SWATCH.hand);
  // Medidas de `character.ts:2991-3013`. A bota cresce 0,1 px para baixo (2,7 de altura, centro −1,15): a sola fica
  // em y = 0 e o topo dela não muda.
  const upperArm = [4, 5.2, 4];
  const forearm = [3.6, 5, 3.6];
  const thigh = [4.25, 5.6, 4.3];
  const shin = [3.75, 4.9, 3.75];
  const boot = [4.05, 2.7, 5.25];
  const handSize = [3.8, 2.2, 3.8];
  writeBox(out, 0, B.head, [0, 4, 0], [8, 8, 8], FIGURE_LAYOUT.head, FIGURE_BOX_FLAG.face);
  writeBox(out, 1, B.torso, [0, 6, 0], [8, 12, 4], FIGURE_LAYOUT.torso, 0);
  writeBox(out, 2, B.upperArmR, [0, -2.4, 0], upperArm, L.sleeve, 0);
  writeBox(out, 3, B.upperArmL, [0, -2.4, 0], upperArm, L.sleeve, 0);
  writeBox(out, 4, B.forearmR, [0, -2.4, 0], forearm, L.forearm, 0);
  writeBox(out, 5, B.forearmL, [0, -2.4, 0], forearm, L.forearm, 0);
  writeBox(out, 6, B.thighR, [0, -2.5, 0], thigh, L.thigh, 0);
  writeBox(out, 7, B.thighL, [0, -2.5, 0], thigh, L.thigh, 0);
  writeBox(out, 8, B.shinR, [0, -1.9, 0], shin, L.shin, 0);
  writeBox(out, 9, B.shinL, [0, -1.9, 0], shin, L.shin, 0);
  writeBox(out, 10, B.footR, [0, -1.15, 0.55], boot, L.boot, 0);
  writeBox(out, 11, B.footL, [0, -1.15, 0.55], boot, L.boot, 0);
  writeBox(out, 12, B.forearmR, [0, -5.6, 0], handSize, hand, 0);
  writeBox(out, 13, B.forearmL, [0, -5.6, 0], handSize, hand, 0);
  return out;
}

/**
 * As 14 caixas do corpo: as 12 primárias na ordem dos ossos, depois a mão D e a mão E (no osso do antebraço). Px no
 * espaço do osso, com a UV do layout (`figure-layout.ts`): cabeça e tronco na cruz; manga, antebraço, coxa e canela nas
 * colunas da farda (a braçadeira, o punho da luva, a joelheira e a barra presa na bota são linhas da coluna; o zumbi
 * pinta nelas a roupa rasgada); mão em amostra de paleta (a luva); bota na mini-cruz. A cabeça leva a flag `face` (a
 * frente lê a célula da expressão).
 */
export const FIGURE_BODY_BOXES: Float32Array = /* @__PURE__ */ buildBodyBoxes();

// --- Posturas e mira ---

export const FIGURE_STANCE = { stand: 0, crouch: 1, slide: 2 } as const;
export const FIGURE_GRIP = { none: 0, pistol: 1, rifle: 2, sniper: 3 } as const;
export const FIGURE_MODE = { base: 0, ads: 1, sprint: 2 } as const;
export type FigureStance = (typeof FIGURE_STANCE)[keyof typeof FIGURE_STANCE];
export type FigureGrip = (typeof FIGURE_GRIP)[keyof typeof FIGURE_GRIP];
export type FigureMode = (typeof FIGURE_MODE)[keyof typeof FIGURE_MODE];

/**
 * 22 posturas: em pé 1 + 3 × 3 = 10 (0 sem arma; 1 + 3·(arma − 1) + modo), agachado 1 + 3 × 2 = 7 (10 sem arma;
 * 11 + 2·(arma − 1) + ADS), deslizando 1 + 3 = 4 (17 sem arma; 17 + arma) e zumbi = 21.
 */
export const FIGURE_POSTURES = 22;
const POSTURE_CROUCH = 10;
const POSTURE_SLIDE = 17;
const POSTURE_ZOMBIE = 21;

/**
 * Postura da tabela de jogo. Regras: zumbi vence tudo; sem arma, o modo é base; deslizando, o modo é sempre base;
 * correr só existe em pé (agachado correndo = agachado base). "Deslizar vence agachar" é de quem escolhe o `stance`: a
 * sim liga `crouching` junto do deslize (`movement.ts:180`), e o `figurePostureOf` dela passa `slide` nesse caso.
 */
export function figurePosture(stance: FigureStance, grip: FigureGrip, mode: FigureMode, zombie: boolean): number {
  if (zombie) return POSTURE_ZOMBIE;
  if (stance === FIGURE_STANCE.slide) return POSTURE_SLIDE + grip;
  if (grip === FIGURE_GRIP.none) return stance === FIGURE_STANCE.crouch ? POSTURE_CROUCH : 0;
  if (stance === FIGURE_STANCE.crouch) return POSTURE_CROUCH + 1 + 2 * (grip - 1) + (mode === FIGURE_MODE.ads ? 1 : 0);
  return 1 + 3 * (grip - 1) + mode;
}

function buildPostureInfo(): Uint8Array {
  const info = new Uint8Array(FIGURE_POSTURES * 3);
  const put = (p: number, stance: number, grip: number, mode: number): void => {
    info[p * 3] = stance;
    info[p * 3 + 1] = grip;
    info[p * 3 + 2] = mode;
  };
  put(0, FIGURE_STANCE.stand, FIGURE_GRIP.none, FIGURE_MODE.base);
  put(POSTURE_CROUCH, FIGURE_STANCE.crouch, FIGURE_GRIP.none, FIGURE_MODE.base);
  put(POSTURE_SLIDE, FIGURE_STANCE.slide, FIGURE_GRIP.none, FIGURE_MODE.base);
  for (let grip = 1; grip <= 3; grip++) {
    for (let mode = 0; mode < 3; mode++) put(1 + 3 * (grip - 1) + mode, FIGURE_STANCE.stand, grip, mode);
    for (let mode = 0; mode < 2; mode++)
      put(POSTURE_CROUCH + 1 + 2 * (grip - 1) + mode, FIGURE_STANCE.crouch, grip, mode);
    put(POSTURE_SLIDE + grip, FIGURE_STANCE.slide, grip, FIGURE_MODE.base);
  }
  // O zumbi não tem arma nem modo; só o índice o distingue.
  put(POSTURE_ZOMBIE, FIGURE_STANCE.stand, FIGURE_GRIP.none, FIGURE_MODE.base);
  return info;
}

/** 22 × 3: stance, grip, mode de cada postura (o render decompõe para misturar). */
export const FIGURE_POSTURE_INFO: Uint8Array = /* @__PURE__ */ buildPostureInfo();

/** Amostras de pitch da tabela de jogo (rad; + = olhar para cima, como o pitch da sim). */
export const FIGURE_PITCH_SAMPLES = [-1.2, -0.6, 0, 0.6, 1.2] as const;

/**
 * "Cabeça presa ao olho" (PLANO §B3): o tronco não leva pitch; em pé a cabeça leva clamp(p; ±0,6); agachada e
 * deslizando, clamp((0,1/0,6)·clamp(p; ±0,6); `headPitchMinCrouch`; `headPitchMaxCrouch`); o pescoço desliza até
 * 1,5 px no rumo da mira; agachado, os braços saturam em +0,6 rad.
 *
 * Agachado e deslizando a cabeça só LEVANTA (decisão 2 da integração, PLANO §I): mínimo 0, porque olhar para baixo
 * (pitch < 0) sobe a quina de TRÁS da cabeça e a expunha por cima do muro de 1,0 m até ~9,7 m (E.3). O mínimo tem de
 * ser 0 ou −`headPitchMaxCrouch`: a dobra cai num pitch de amostra (0 ou −0,6) e a cabeça segue linear por intervalo,
 * como a tabela interpola.
 */
export const FIGURE_AIM = {
  torsoPitchShare: 0,
  headPitchMaxStand: 0.6,
  headPitchMaxCrouch: 0.1,
  headPitchMinCrouch: 0,
  neckSlideMaxPx: 1.5,
  armPitchMaxCrouch: 0.6,
} as const;

// --- Raiz e FK ---

/**
 * Raiz: T(x, y, z)·Ry(yaw + π)·S(FIGURE_PX_M·scale·(1 − s/2, 1 + s, 1 − s/2)). `yaw` na convenção do BoboForces
 * (`m4RotateY`: yaw > 0 leva −Z para −X; yaw 0 olha para −Z). O Ry(π) põe a frente +z do FutBobo em −Z e a esquerda
 * +x em −X. Escreve a matriz inteira (4ª linha 0, 0, 0, 1) em out[o .. o+16).
 */
export function figureRoot(
  out: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  scale: number,
  squash: number,
): void {
  // quente:
  // cos e sen de (yaw + π) sem somar π (que arredondaria).
  const c = -Math.cos(yaw);
  const s = -Math.sin(yaw);
  const k = FIGURE_PX_M * scale;
  const kxz = k * (1 - 0.5 * squash);
  const ky = k * (1 + squash);
  out[o] = c * kxz;
  out[o + 1] = 0;
  out[o + 2] = -s * kxz;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = ky;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = s * kxz;
  out[o + 9] = 0;
  out[o + 10] = c * kxz;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
  // fim-quente
}

/**
 * Juntas do FutBobo (px; `character.ts:2947-2976` e `:50`), as mesmas do `figureFk`. Exportadas para o IK da tabela
 * (F1) e o `legDrop` da animação (F4) não repetirem os números.
 */
export const FIGURE_JOINT = {
  pivotH: 13,
  hipsY: 12,
  neckY: 12,
  shoulderX: 6,
  shoulderY: 11.5,
  upperArm: 4.9,
  hipX: 2.05,
  hipY: 0.4,
  thigh: 5.6,
  shin: 4.3,
} as const;
const PIVOT_H = FIGURE_JOINT.pivotH;
const HIPS_Y = FIGURE_JOINT.hipsY;
const NECK_Y = FIGURE_JOINT.neckY;
const SHOULDER_X = FIGURE_JOINT.shoulderX;
const SHOULDER_Y = FIGURE_JOINT.shoulderY;
const UPPER_ARM = FIGURE_JOINT.upperArm;
const HIP_X = FIGURE_JOINT.hipX;
const HIP_Y = FIGURE_JOINT.hipY;
const THIGH = FIGURE_JOINT.thigh;
const SHIN = FIGURE_JOINT.shin;

// Rascunho do FK em float64, criado uma vez: 15 afins de 12 números (R coluna-maior em 0..8, t em 9..11). Os 12
// primeiros são os ossos na ordem de FIGURE_BONE; depois raiz·Ry(spinY), corpo e hips. Depois deles, os argumentos da
// junta em composição: os auxiliares do FK recebem SÓ índices, porque um double passado a uma função que o V8 não
// inlina vira HeapNumber (o FK alocava ~0,8 KB por chamada com JIT).
const AFF = 12;
/** Argumentos da junta seguinte: ângulos x, y, z (rad) e translação tx, ty, tz (px) no espaço do pai. */
const ARG = 15 * AFF;
const FK = /* @__PURE__ */ new Float64Array(ARG + 6);
const HEAD = FIGURE_BONE.head * AFF;
const TORSO = FIGURE_BONE.torso * AFF;
const ARM_R = FIGURE_BONE.upperArmR * AFF;
const ARM_L = FIGURE_BONE.upperArmL * AFF;
const FORE_R = FIGURE_BONE.forearmR * AFF;
const FORE_L = FIGURE_BONE.forearmL * AFF;
const THIGH_R = FIGURE_BONE.thighR * AFF;
const THIGH_L = FIGURE_BONE.thighL * AFF;
const SHIN_R = FIGURE_BONE.shinR * AFF;
const SHIN_L = FIGURE_BONE.shinL * AFF;
const FOOT_R = FIGURE_BONE.footR * AFF;
const FOOT_L = FIGURE_BONE.footL * AFF;
const SPUN = 12 * AFF;
const BODY = 13 * AFF;
const HIPS = 14 * AFF;

/** Junta com Euler XYZ do three (Rx·Ry·Rz), em forma fechada: m[d] = m[a]·[L | t], argumentos x, y, z, t em m[ARG ..]. */
function composeXYZ(m: Float64Array, d: number, a: number): void {
  // quente:
  const cx = Math.cos(m[ARG]!);
  const sx = Math.sin(m[ARG]!);
  const cy = Math.cos(m[ARG + 1]!);
  const sy = Math.sin(m[ARG + 1]!);
  const cz = Math.cos(m[ARG + 2]!);
  const sz = Math.sin(m[ARG + 2]!);
  const tx = m[ARG + 3]!;
  const ty = m[ARG + 4]!;
  const tz = m[ARG + 5]!;
  // L por linhas (l<linha><coluna>).
  const l00 = cy * cz;
  const l01 = -cy * sz;
  const l02 = sy;
  const l10 = cx * sz + sx * sy * cz;
  const l11 = cx * cz - sx * sy * sz;
  const l12 = -sx * cy;
  const l20 = sx * sz - cx * sy * cz;
  const l21 = sx * cz + cx * sy * sz;
  const l22 = cx * cy;
  const a0 = m[a]!;
  const a1 = m[a + 1]!;
  const a2 = m[a + 2]!;
  const b0 = m[a + 3]!;
  const b1 = m[a + 4]!;
  const b2 = m[a + 5]!;
  const c0 = m[a + 6]!;
  const c1 = m[a + 7]!;
  const c2 = m[a + 8]!;
  m[d] = a0 * l00 + b0 * l10 + c0 * l20;
  m[d + 1] = a1 * l00 + b1 * l10 + c1 * l20;
  m[d + 2] = a2 * l00 + b2 * l10 + c2 * l20;
  m[d + 3] = a0 * l01 + b0 * l11 + c0 * l21;
  m[d + 4] = a1 * l01 + b1 * l11 + c1 * l21;
  m[d + 5] = a2 * l01 + b2 * l11 + c2 * l21;
  m[d + 6] = a0 * l02 + b0 * l12 + c0 * l22;
  m[d + 7] = a1 * l02 + b1 * l12 + c1 * l22;
  m[d + 8] = a2 * l02 + b2 * l12 + c2 * l22;
  m[d + 9] = a0 * tx + b0 * ty + c0 * tz + m[a + 9]!;
  m[d + 10] = a1 * tx + b1 * ty + c1 * tz + m[a + 10]!;
  m[d + 11] = a2 * tx + b2 * ty + c2 * tz + m[a + 11]!;
  // fim-quente
}

/**
 * Junta com Rx·Rz (Euler XYZ com y = 0: corpo, quadril, tornozelo): m[d] = m[a]·[L | t], argumentos x, z, t em m[ARG ..].
 * L = [cz, −sz, 0; cx·sz, cx·cz, −sx; sx·sz, sx·cz, cx] (os produtos pelo 0 ficam como no 4×4).
 */
function composeXZ(m: Float64Array, d: number, a: number): void {
  // quente:
  const cx = Math.cos(m[ARG]!);
  const sx = Math.sin(m[ARG]!);
  const cz = Math.cos(m[ARG + 2]!);
  const sz = Math.sin(m[ARG + 2]!);
  const tx = m[ARG + 3]!;
  const ty = m[ARG + 4]!;
  const tz = m[ARG + 5]!;
  const l00 = cz;
  const l01 = -sz;
  const l02 = 0;
  const l10 = cx * sz;
  const l11 = cx * cz;
  const l12 = -sx;
  const l20 = sx * sz;
  const l21 = sx * cz;
  const l22 = cx;
  const a0 = m[a]!;
  const a1 = m[a + 1]!;
  const a2 = m[a + 2]!;
  const b0 = m[a + 3]!;
  const b1 = m[a + 4]!;
  const b2 = m[a + 5]!;
  const c0 = m[a + 6]!;
  const c1 = m[a + 7]!;
  const c2 = m[a + 8]!;
  m[d] = a0 * l00 + b0 * l10 + c0 * l20;
  m[d + 1] = a1 * l00 + b1 * l10 + c1 * l20;
  m[d + 2] = a2 * l00 + b2 * l10 + c2 * l20;
  m[d + 3] = a0 * l01 + b0 * l11 + c0 * l21;
  m[d + 4] = a1 * l01 + b1 * l11 + c1 * l21;
  m[d + 5] = a2 * l01 + b2 * l11 + c2 * l21;
  m[d + 6] = a0 * l02 + b0 * l12 + c0 * l22;
  m[d + 7] = a1 * l02 + b1 * l12 + c1 * l22;
  m[d + 8] = a2 * l02 + b2 * l12 + c2 * l22;
  m[d + 9] = a0 * tx + b0 * ty + c0 * tz + m[a + 9]!;
  m[d + 10] = a1 * tx + b1 * ty + c1 * tz + m[a + 10]!;
  m[d + 11] = a2 * tx + b2 * ty + c2 * tz + m[a + 11]!;
  // fim-quente
}

/** Junta só com Rx (cotovelo, joelho); argumentos x, t em m[ARG ..]. */
function composeX(m: Float64Array, d: number, a: number): void {
  // quente:
  const c = Math.cos(m[ARG]!);
  const s = Math.sin(m[ARG]!);
  const tx = m[ARG + 3]!;
  const ty = m[ARG + 4]!;
  const tz = m[ARG + 5]!;
  const a0 = m[a]!;
  const a1 = m[a + 1]!;
  const a2 = m[a + 2]!;
  const b0 = m[a + 3]!;
  const b1 = m[a + 4]!;
  const b2 = m[a + 5]!;
  const c0 = m[a + 6]!;
  const c1 = m[a + 7]!;
  const c2 = m[a + 8]!;
  m[d + 9] = a0 * tx + b0 * ty + c0 * tz + m[a + 9]!;
  m[d + 10] = a1 * tx + b1 * ty + c1 * tz + m[a + 10]!;
  m[d + 11] = a2 * tx + b2 * ty + c2 * tz + m[a + 11]!;
  m[d] = a0;
  m[d + 1] = a1;
  m[d + 2] = a2;
  m[d + 3] = b0 * c + c0 * s;
  m[d + 4] = b1 * c + c1 * s;
  m[d + 5] = b2 * c + c2 * s;
  m[d + 6] = c0 * c - b0 * s;
  m[d + 7] = c1 * c - b1 * s;
  m[d + 8] = c2 * c - b2 * s;
  // fim-quente
}

/** Junta só com Ry (hips); argumentos y, t em m[ARG ..]. */
function composeY(m: Float64Array, d: number, a: number): void {
  // quente:
  const c = Math.cos(m[ARG + 1]!);
  const s = Math.sin(m[ARG + 1]!);
  const tx = m[ARG + 3]!;
  const ty = m[ARG + 4]!;
  const tz = m[ARG + 5]!;
  const a0 = m[a]!;
  const a1 = m[a + 1]!;
  const a2 = m[a + 2]!;
  const c0 = m[a + 6]!;
  const c1 = m[a + 7]!;
  const c2 = m[a + 8]!;
  m[d + 9] = a0 * tx + m[a + 3]! * ty + c0 * tz + m[a + 9]!;
  m[d + 10] = a1 * tx + m[a + 4]! * ty + c1 * tz + m[a + 10]!;
  m[d + 11] = a2 * tx + m[a + 5]! * ty + c2 * tz + m[a + 11]!;
  m[d] = a0 * c - c0 * s;
  m[d + 1] = a1 * c - c1 * s;
  m[d + 2] = a2 * c - c2 * s;
  m[d + 3] = m[a + 3]!;
  m[d + 4] = m[a + 4]!;
  m[d + 5] = m[a + 5]!;
  m[d + 6] = a0 * s + c0 * c;
  m[d + 7] = a1 * s + c1 * c;
  m[d + 8] = a2 * s + c2 * c;
  // fim-quente
}

/**
 * FK afim (Euler XYZ em forma fechada; pivô duplo do corpo; neckSink/torsoSink/neckSlide). Porte de
 * `character.ts:4099-4159` com as juntas de `:2947-2976`: raiz·Ry(spinY) (o `spinY` do FutBobo gira a raiz e comuta com
 * a escala, que tem Sx = Sz) → corpo T(bodyXYZ + pé − total)·Rx(ax)·Rz(az), com `bodyRotX/Z` nos pés e `pivX/Z` no
 * quadril a `PIVOT_H` 13 → hips T(0, 12, 0)·Ry(hipsY) → ossos.
 *
 * Pé plano: a pose traz o giro X do tornozelo; o giro Z dele é sempre −hipZ (desfaz a abertura lateral do quadril). É
 * diferença consciente: o FutBobo usa −hipZ·peso, com peso = (1 − smooth(|canela|; 0,7..1,3))·(1 − 0,55·corrida)
 * (`character.ts:4127-4134`); parado e com a canela perto da vertical o peso é 1 e os dois coincidem. Correndo de lado
 * o FutBobo gira só 0,45·hipZ, e com a canela dobrada menos ainda: a chuteira muda ~0,3 px (`sitDown` 0,29 px; passinho
 * lateral correndo com hipZ 0,25, 0,36 px; o `figure.test.ts` mede). A pose não tem chave do Z do tornozelo (C1); o pé
 * plano da animação escreve só o X.
 *
 * Escreve as 12 matrizes dos ossos (16 floats, coluna-maior, metros do mundo) em out[o .. o+192), na ordem de
 * FIGURE_BONE. Não lê nem escreve a 4ª linha (nem na raiz nem na saída). Sem alocação.
 */
export function figureFk(
  pose: Float32Array,
  po: number,
  root: Float32Array,
  ro: number,
  out: Float32Array,
  o: number,
): void {
  // quente:
  const m = FK;
  const P = FIGURE_POSE;

  // Raiz·Ry(spinY).
  const spin = pose[po + P.spinY]!;
  const cs = Math.cos(spin);
  const ss = Math.sin(spin);
  const r0 = root[ro]!;
  const r1 = root[ro + 1]!;
  const r2 = root[ro + 2]!;
  const r8 = root[ro + 8]!;
  const r9 = root[ro + 9]!;
  const r10 = root[ro + 10]!;
  m[SPUN] = r0 * cs - r8 * ss;
  m[SPUN + 1] = r1 * cs - r9 * ss;
  m[SPUN + 2] = r2 * cs - r10 * ss;
  m[SPUN + 3] = root[ro + 4]!;
  m[SPUN + 4] = root[ro + 5]!;
  m[SPUN + 5] = root[ro + 6]!;
  m[SPUN + 6] = r0 * ss + r8 * cs;
  m[SPUN + 7] = r1 * ss + r9 * cs;
  m[SPUN + 8] = r2 * ss + r10 * cs;
  m[SPUN + 9] = root[ro + 12]!;
  m[SPUN + 10] = root[ro + 13]!;
  m[SPUN + 11] = root[ro + 14]!;

  // Corpo: inclinações (bodyRot) giram nos pés; mortal e mergulho (piv), no quadril.
  const rx = pose[po + P.bodyRotX]!;
  const rz = pose[po + P.bodyRotZ]!;
  const ax = rx + pose[po + P.pivX]!;
  const az = rz + pose[po + P.pivZ]!;
  const crz = Math.cos(rz);
  const caz = Math.cos(az);
  const footX = -PIVOT_H * Math.sin(rz);
  const footY = PIVOT_H * crz * Math.cos(rx);
  const footZ = PIVOT_H * crz * Math.sin(rx);
  const totalX = -PIVOT_H * Math.sin(az);
  const totalY = PIVOT_H * caz * Math.cos(ax);
  const totalZ = PIVOT_H * caz * Math.sin(ax);
  m[ARG] = ax;
  m[ARG + 2] = az;
  m[ARG + 3] = pose[po + P.bodyX]! + footX - totalX;
  m[ARG + 4] = pose[po + P.bodyY]! + footY - totalY;
  m[ARG + 5] = pose[po + P.bodyZ]! + footZ - totalZ;
  composeXZ(m, BODY, SPUN);
  m[ARG + 1] = pose[po + P.hipsY]!;
  m[ARG + 3] = 0;
  m[ARG + 4] = HIPS_Y;
  m[ARG + 5] = 0;
  composeY(m, HIPS, BODY);

  // Tronco, cabeça e braços.
  m[ARG] = pose[po + P.torsoX]!;
  m[ARG + 1] = pose[po + P.torsoY]!;
  m[ARG + 2] = pose[po + P.torsoZ]!;
  m[ARG + 4] = -pose[po + P.torsoSink]!;
  composeXYZ(m, TORSO, HIPS);
  m[ARG] = pose[po + P.neckX]!;
  m[ARG + 1] = pose[po + P.neckY]!;
  m[ARG + 2] = pose[po + P.neckZ]!;
  m[ARG + 4] = NECK_Y - pose[po + P.neckSink]!;
  composeXYZ(m, HEAD, TORSO);
  // neckSlide: px ao longo da frente da raiz (col2 da raiz já é metro por px do boneco).
  const slide = pose[po + P.neckSlide]!;
  m[HEAD + 9] = m[HEAD + 9]! + slide * r8;
  m[HEAD + 10] = m[HEAD + 10]! + slide * r9;
  m[HEAD + 11] = m[HEAD + 11]! + slide * r10;
  m[ARG] = pose[po + P.shRX]!;
  m[ARG + 1] = pose[po + P.shRY]!;
  m[ARG + 2] = pose[po + P.shRZ]!;
  m[ARG + 3] = -SHOULDER_X;
  m[ARG + 4] = SHOULDER_Y;
  composeXYZ(m, ARM_R, TORSO);
  m[ARG] = pose[po + P.shLX]!;
  m[ARG + 1] = pose[po + P.shLY]!;
  m[ARG + 2] = pose[po + P.shLZ]!;
  m[ARG + 3] = SHOULDER_X;
  composeXYZ(m, ARM_L, TORSO);
  m[ARG] = pose[po + P.elR]!;
  m[ARG + 3] = 0;
  m[ARG + 4] = -UPPER_ARM;
  composeX(m, FORE_R, ARM_R);
  m[ARG] = pose[po + P.elL]!;
  composeX(m, FORE_L, ARM_L);

  // Pernas: quadril X e Z, joelho X, tornozelo X da pose e Z = −hipZ.
  const hipRZ = pose[po + P.hipRZ]!;
  const hipLZ = pose[po + P.hipLZ]!;
  m[ARG] = pose[po + P.hipRX]!;
  m[ARG + 2] = hipRZ;
  m[ARG + 3] = -HIP_X;
  m[ARG + 4] = HIP_Y;
  composeXZ(m, THIGH_R, HIPS);
  m[ARG] = pose[po + P.hipLX]!;
  m[ARG + 2] = hipLZ;
  m[ARG + 3] = HIP_X;
  composeXZ(m, THIGH_L, HIPS);
  m[ARG] = pose[po + P.kneeR]!;
  m[ARG + 3] = 0;
  m[ARG + 4] = -THIGH;
  composeX(m, SHIN_R, THIGH_R);
  m[ARG] = pose[po + P.kneeL]!;
  composeX(m, SHIN_L, THIGH_L);
  m[ARG] = pose[po + P.ankleR]!;
  m[ARG + 2] = -hipRZ;
  m[ARG + 4] = -SHIN;
  composeXZ(m, FOOT_R, SHIN_R);
  m[ARG] = pose[po + P.ankleL]!;
  m[ARG + 2] = -hipLZ;
  composeXZ(m, FOOT_L, SHIN_L);

  // Saída: 3×4 de cada osso, a 4ª linha intocada.
  for (let b = 0; b < FIGURE_BONES; b++) {
    const s = b * AFF;
    const d = o + b * 16;
    out[d] = m[s]!;
    out[d + 1] = m[s + 1]!;
    out[d + 2] = m[s + 2]!;
    out[d + 4] = m[s + 3]!;
    out[d + 5] = m[s + 4]!;
    out[d + 6] = m[s + 5]!;
    out[d + 8] = m[s + 6]!;
    out[d + 9] = m[s + 7]!;
    out[d + 10] = m[s + 8]!;
    out[d + 12] = m[s + 9]!;
    out[d + 13] = m[s + 10]!;
    out[d + 14] = m[s + 11]!;
  }
  // fim-quente
}
