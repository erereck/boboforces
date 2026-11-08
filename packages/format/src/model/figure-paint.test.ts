import { createRng, fnv1a32 } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { boxCrossRects, FACE_EXPRESSIONS, SKIN_FACE_AXES, ZOMBIE_KINDS } from './bobo.ts';
import {
  FIGURE_BODY_BOXES,
  FIGURE_BONE,
  FIGURE_BONES,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_FLAG,
  FIGURE_BOX_STRIDE,
  FIGURE_REST_POSE,
  figureFk,
  figureRoot,
} from './figure.ts';
import { FIGURE_SKIN_BYTES, FIGURE_SKIN_LEVEL1_BYTES, FIGURE_SWATCH, figureSwatchCorner } from './figure-layout.ts';
import {
  FIGURE_LOOK_DEFAULT,
  figureColorDistance,
  figureSkinKey,
  normalizeFigureLook,
  type FigureLook,
  type FigureSkinRecipe,
} from './figure-look.ts';
import { figureFabricTones } from './figure-paint-outfit.ts';
import { disposeFigurePaint, FIGURE_PAINT_REGIONS, paintFigureSkin } from './figure-paint.ts';
import { FIGURE_PRESETS, type FigurePresetId } from './figure-presets.ts';

const TEAMS = [0xff7a1a, 0x2e8bff];
const IDS = Object.keys(FIGURE_PRESETS) as FigurePresetId[];

function paint(recipe: FigureSkinRecipe): { out: Uint8Array; l1: Uint8Array } {
  const out = new Uint8Array(FIGURE_SKIN_BYTES);
  const l1 = new Uint8Array(FIGURE_SKIN_LEVEL1_BYTES);
  paintFigureSkin(recipe, out, l1);
  return { out, l1 };
}

function rgbAt(skin: Uint8Array, layer: number, u: number, v: number): number {
  const o = (layer * 4096 + v * 64 + u) * 4;
  return (skin[o]! << 16) | (skin[o + 1]! << 8) | skin[o + 2]!;
}

function inRegion(layer: number, u: number, v: number, half: boolean): boolean {
  const k = half ? 2 : 1;
  for (const r of FIGURE_PAINT_REGIONS) {
    if (r.layer === layer && u >= r.u / k && u < (r.u + r.w) / k && v >= r.v / k && v < (r.v + r.h) / k) return true;
  }
  return false;
}

/** `shadeHex` do FutBobo, para os testes conferirem cores derivadas sem o código do pintor. */
function shade(c: number, a: number): number {
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return (ch(((c >> 16) & 255) + a) << 16) | (ch(((c >> 8) & 255) + a) << 8) | ch((c & 255) + a);
}

/** `mixHex` do FutBobo: a + (b − a)·t por canal, arredondado. */
function mix(a: number, b: number, t: number): number {
  const ch = (x: number, y: number): number => Math.max(0, Math.min(255, Math.round(x + (y - x) * t)));
  return (
    (ch((a >> 16) & 255, (b >> 16) & 255) << 16) | (ch((a >> 8) & 255, (b >> 8) & 255) << 8) | ch(a & 255, b & 255)
  );
}

/** Tom de detalhe da farda: `a` mais escuro, ou ¾ de `a` mais claro nas cores quase pretas (luminância < 0,16). */
function detail(c: number, a: number): number {
  const lum = (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;
  return lum < 0.16 ? shade(c, (a * 3) >> 2) : shade(c, -a);
}

/** Pior cobertura da cor do time na frente (os 12 looks nos 4 times), medida e travada aqui (arte-ux §2.2). */
const COVERAGE_MIN = 0.381;

/**
 * Hash FNV-1a das 2 camadas + nível 1 (E.6), sem time e nos times A e B da partida [A, B]. Mudou de propósito
 * (pintor, look ou layout): atualize junto com a prévia (`node tools/skingen/src/figuras.ts`) e um print.
 */
const SKIN_HASHES: Readonly<Record<FigurePresetId, readonly [string, string, string]>> = {
  recruit: ['b349cf14', '874e2932', 'c6d96010'],
  mechanic: ['8a57c659', '3a7a4f08', 'd7cecbbd'],
  pilot: ['a81cecda', '9de1eea4', '1caa626f'],
  zombie: ['087e56f5', '852abfd8', '366606e6'],
  classico: ['4f4a400f', '8a526fa2', '4bc5e143'],
  blackpower: ['5f494b16', 'bac7e42b', 'c8b0a494'],
  sardento: ['f5de99db', '43a83770', 'b2822b4f'],
  dreads: ['84a5a624', 'ffa3458c', '89a78fae'],
  bandana: ['2ab9adda', '42bb3265', '5a09f562'],
  moicano: ['e81ec0fa', 'de286129', '72c745d8'],
  barbudo: ['0718571a', '05ebdc78', '9334c583'],
  trancas: ['e3fd6579', '9b363df7', 'f86504a6'],
};
/** Zumbi comum nos 8 estilos de rosto, e os 5 tipos no estilo 0 (sem time). */
const ZOMBIE_STYLE_HASHES = [
  '087e56f5',
  'c71d1ccb',
  'e224ab7d',
  '25a62c95',
  '608760e7',
  'f8b1aef9',
  'c3bb7675',
  '9729b5af',
];
const ZOMBIE_KIND_HASHES: Readonly<Record<string, string>> = {
  common: '087e56f5',
  sprinter: 'ebe97a5f',
  chonker: '6f553a95',
  spitter: 'b49bb29f',
  mega: 'c9eb40a1',
};

function skinHash(recipe: FigureSkinRecipe): string {
  const { out, l1 } = paint(recipe);
  return fnv1a32(l1, fnv1a32(out)).toString(16).padStart(8, '0');
}

describe('pintor do boneco: determinismo (E.6)', () => {
  it('hash das 2 camadas + nível 1 dos 12 looks × {sem time, A, B} travado', () => {
    for (const id of IDS) {
      const got = [-1, 0, 1].map((team) => skinHash({ look: FIGURE_PRESETS[id], team, teamColors: TEAMS }));
      expect(got, id).toEqual(SKIN_HASHES[id]);
    }
  });

  it('zumbi: os 8 estilos de rosto e os 5 tipos, travados', () => {
    const z = FIGURE_PRESETS.zombie;
    for (let s = 0; s < 8; s++) {
      const look = normalizeFigureLook({ ...z, zombie: { kind: 'common', faceStyle: s } });
      expect(skinHash({ look, team: -1, teamColors: TEAMS }), `estilo ${s}`).toBe(ZOMBIE_STYLE_HASHES[s]);
    }
    for (const kind of ZOMBIE_KINDS) {
      const look = normalizeFigureLook({ ...z, zombie: { kind, faceStyle: 0 } });
      expect(skinHash({ look, team: -1, teamColors: TEAMS }), kind).toBe(ZOMBIE_KIND_HASHES[kind]);
    }
  });

  it('pintar 2× dá o mesmo, inclusive sobre um buffer com lixo nas regiões usadas', () => {
    const recipe = { look: FIGURE_PRESETS.trancas, team: 1, teamColors: TEAMS };
    const a = paint(recipe);
    const out = new Uint8Array(FIGURE_SKIN_BYTES).fill(0x5a);
    const l1 = new Uint8Array(FIGURE_SKIN_LEVEL1_BYTES).fill(0x5a);
    paintFigureSkin({ look: FIGURE_PRESETS.recruit, team: 0, teamColors: TEAMS }, out, l1);
    paintFigureSkin(recipe, out, l1);
    paintFigureSkin(recipe, out, l1);
    for (let i = 0; i < FIGURE_SKIN_BYTES / 4; i++) {
      const layer = i >> 12;
      if (!inRegion(layer, i & 63, (i >> 6) & 63, false)) continue;
      expect(out.subarray(i * 4, i * 4 + 4), `texel ${i}`).toEqual(a.out.subarray(i * 4, i * 4 + 4));
    }
  });
});

/** Look sorteado com tudo na faixa (inclusive fora dela, para o normalizador) e às vezes zumbi. */
function randomLook(rng: ReturnType<typeof createRng>): FigureLook {
  return normalizeFigureLook({
    skinTone: rng.int(0, 0x1000000),
    hair: rng.int(0, 0x1000000),
    hairTop: rng.int(0, 0x1000000),
    eyes: rng.int(0, 0x1000000),
    hairStyle: rng.int(-2, 36),
    face: rng.int(-1, 12),
    brow: rng.int(-1, 6),
    beard: rng.int(-1, 13),
    faceMark: rng.int(-1, 7),
    headwear: rng.int(-1, 6),
    eyewear: rng.int(-1, 5),
    earrings: rng.int(-1, 5),
    accessory: rng.int(0, 0x1000000),
    outfit: {
      fabric: rng.int(-1, 8),
      jacket: rng.int(0, 0x1000000),
      pants: rng.int(0, 0x1000000),
      vest: rng.chance(0.3) ? -1 : rng.int(0, 0x1000000),
      boots: rng.int(0, 0x1000000),
      gloves: rng.chance(0.3) ? -1 : rng.int(0, 0x1000000),
    },
    zombie: rng.chance(0.2) ? { kind: ZOMBIE_KINDS[rng.int(0, ZOMBIE_KINDS.length)]!, faceStyle: rng.int(0, 8) } : null,
  });
}

describe('pintor do boneco: regiões, opacidade e nível 1 (E.6)', () => {
  it('cantos e medidas pares em todas as regiões; nenhuma passa de 64×64 nem se sobrepõe', () => {
    const grids = [new Uint8Array(4096), new Uint8Array(4096)];
    for (const r of FIGURE_PAINT_REGIONS) {
      expect([r.u % 2, r.v % 2, r.w % 2, r.h % 2]).toEqual([0, 0, 0, 0]);
      expect(r.u + r.w <= 64 && r.v + r.h <= 64 && r.layer >= 0 && r.layer < 2).toBe(true);
      for (let v = r.v; v < r.v + r.h; v++) {
        for (let u = r.u; u < r.u + r.w; u++) {
          expect(grids[r.layer]![v * 64 + u]).toBe(0);
          grids[r.layer]![v * 64 + u] = 1;
        }
      }
    }
  });

  it('500 looks sorteados (createRng): sentinela intacta fora das regiões, opaco dentro, nível 1 = caixa 2×2', () => {
    const rng = createRng('figure-paint:e6');
    const SENTINEL = 0xa5;
    const out = new Uint8Array(FIGURE_SKIN_BYTES);
    const l1 = new Uint8Array(FIGURE_SKIN_LEVEL1_BYTES);
    let freeTexels = 0;
    for (let n = 0; n < 500; n++) {
      out.fill(SENTINEL);
      l1.fill(SENTINEL);
      const teams = rng.chance(0.5) ? TEAMS : [0xff7a1a, 0x2e8bff, 0x3ddc97, 0xa66bff];
      paintFigureSkin({ look: randomLook(rng), team: rng.int(-1, 5), teamColors: teams }, out, l1);
      let bad = 0;
      for (let i = 0; i < FIGURE_SKIN_BYTES / 4; i++) {
        const used = inRegion(i >> 12, i & 63, (i >> 6) & 63, false);
        if (used) {
          if (out[i * 4 + 3] !== 255) bad++;
        } else {
          if (n === 0) freeTexels++;
          for (let k = 0; k < 4; k++) if (out[i * 4 + k] !== SENTINEL) bad++;
        }
      }
      for (let i = 0; i < FIGURE_SKIN_LEVEL1_BYTES / 4; i++) {
        const layer = i >> 10;
        const x = i & 31;
        const y = (i >> 5) & 31;
        if (!inRegion(layer, x, y, true)) {
          for (let k = 0; k < 4; k++) if (l1[i * 4 + k] !== SENTINEL) bad++;
          continue;
        }
        const a = (layer * 4096 + 2 * y * 64 + 2 * x) * 4;
        for (let k = 0; k < 4; k++) {
          const sum = out[a + k]! + out[a + 4 + k]! + out[a + 256 + k]! + out[a + 260 + k]!;
          if (l1[i * 4 + k] !== (sum + 2) >> 2) bad++;
        }
      }
      expect(bad, `look ${n}`).toBe(0);
    }
    // Livres: (48, 0, 16, 16) na camada 0; (60, 12, 4, 12), (48, 24, 16, 8) e a reserva (0, 32, 64, 32) na 1.
    expect(freeTexels).toBe(256 + 48 + 128 + 2048);
  });

  it('chave da skin × bytes: receitas com a mesma chave pintam igual; mudar o que pinta muda a chave', () => {
    const rng = createRng('figure-paint:chave');
    const teams = [0xff7a1a, 0x2e8bff];
    const same = (a: FigureSkinRecipe, b: FigureSkinRecipe): boolean => {
      const pa = paint(a);
      const pb = paint(b);
      return fnv1a32(pa.l1, fnv1a32(pa.out)) === fnv1a32(pb.l1, fnv1a32(pb.out));
    };
    for (let n = 0; n < 60; n++) {
      const look = randomLook(rng);
      const team = rng.int(0, 2);
      // Mesma chave: sem time −1 = 255; com time, colete e luvas do look não contam; acessório 3D não pinta; trava.
      const pairs: [FigureSkinRecipe, FigureSkinRecipe][] = [
        [
          { look, team: -1, teamColors: teams },
          { look, team: 255, teamColors: teams },
        ],
        [
          { look, team, teamColors: teams },
          {
            look: { ...look, outfit: { ...look.outfit, vest: look.outfit.vest < 0 ? 0x123456 : -1, gloves: 0x654321 } },
            team,
            teamColors: teams,
          },
        ],
        [
          { look, team: -1, teamColors: teams },
          { look: { ...look, hat3d: 'cap', back: 'pack' }, team: -1, teamColors: teams },
        ],
        [
          { look: { ...look, accessory: 0xff7a1a }, team: -1, teamColors: teams },
          { look: { ...look, accessory: 0x141414 }, team: -1, teamColors: teams },
        ],
        [
          { look: { ...look, outfit: { ...look.outfit, jacket: 0x2e8bff, boots: 0xff7a1a } }, team, teamColors: teams },
          { look: { ...look, outfit: { ...look.outfit, jacket: 0x141414, boots: 0x141414 } }, team, teamColors: teams },
        ],
      ];
      for (const [a, b] of pairs) {
        expect(figureSkinKey(a), `look ${n}`).toBe(figureSkinKey(b));
        expect(same(a, b), `look ${n}`).toBe(true);
      }
      // Chave diferente quando muda o que sempre aparece (a pele). O contrário não vale: os olhos atrás de óculos
      // escuros mudam a chave sem mudar os bytes (a chave só divide a mais, nunca junta skins diferentes).
      const base = { look, team: -1, teamColors: teams };
      const tone = { look: { ...look, skinTone: look.skinTone ^ 0x404040 }, team: -1, teamColors: teams };
      expect(figureSkinKey(tone)).not.toBe(figureSkinKey(base));
      expect(same(tone, base)).toBe(false);
    }
  });

  it('disposeFigurePaint solta os buffers guardados; pintar depois (no mesmo buffer ou num novo) dá o mesmo', () => {
    const recipe = { look: FIGURE_PRESETS.pilot, team: 0, teamColors: TEAMS };
    const want = skinHash(recipe);
    const out = new Uint8Array(FIGURE_SKIN_BYTES);
    const l1 = new Uint8Array(FIGURE_SKIN_LEVEL1_BYTES);
    paintFigureSkin(recipe, out, l1);
    disposeFigurePaint();
    disposeFigurePaint();
    paintFigureSkin(recipe, out, l1);
    expect(fnv1a32(l1, fnv1a32(out)).toString(16).padStart(8, '0')).toBe(want);
    disposeFigurePaint();
    expect(skinHash(recipe)).toBe(want);
  });

  it('buffers desalinhados ou curtos lançam (no loading), sem pintar pela metade', () => {
    const big = new Uint8Array(FIGURE_SKIN_BYTES + 4);
    const l1 = new Uint8Array(FIGURE_SKIN_LEVEL1_BYTES);
    const recipe = { look: FIGURE_PRESETS.recruit, team: -1, teamColors: [] };
    expect(() => paintFigureSkin(recipe, big.subarray(1, 1 + FIGURE_SKIN_BYTES), l1)).toThrow('alinhado');
    expect(() => paintFigureSkin(recipe, new Uint8Array(100), l1)).toThrow('precisa de');
    expect(() => paintFigureSkin(recipe, big.subarray(4), new Uint8Array(8))).toThrow('precisa de');
  });
});

// --- Gêmeo JS da UV do cubo das figuras (PLANO §B7): o `addTexturedBox` do BF girado Ry(π) ---

interface UvHit {
  readonly face: number;
  readonly u: number;
  readonly v: number;
}

/**
 * Texel que o render lê num ponto `q` da superfície de uma caixa, em coordenadas do FutBobo normalizadas
 * ([−0,5; 0,5]³; frente +z, +x = esquerda do boneco). Ry(π) leva ao espaço da caixa do BF; a face é a do eixo
 * dominante; a UV segue `boxCrossRects` + `SKIN_FACE_AXES` (o contrato do `addTexturedBox`).
 */
function uvTwin(uv: { u: number; v: number; w: number; h: number; d: number }, q: readonly number[]): UvHit {
  const p = [-q[0]!, q[1]!, -q[2]!];
  let axis = 0;
  for (let k = 1; k < 3; k++) if (Math.abs(p[k]!) > Math.abs(p[axis]!)) axis = k;
  const face = 2 * axis + (p[axis]! > 0 ? 0 : 1);
  const r = boxCrossRects(uv.u, uv.v, uv.w, uv.h, uv.d)[face]!;
  const ax = SKIN_FACE_AXES[face]!;
  const a = p[0]! * ax.u[0] + p[1]! * ax.u[1] + p[2]! * ax.u[2] + 0.5;
  const b = p[0]! * ax.v[0] + p[1]! * ax.v[1] + p[2]! * ax.v[2] + 0.5;
  return { face, u: Math.floor(r.u + a * r.w), v: Math.floor(r.v + b * r.h) };
}

function headUv(): { u: number; v: number; w: number; h: number; d: number; flags: number } {
  const F = FIGURE_BOX_FIELD;
  const b = FIGURE_BODY_BOXES;
  expect(b[F.bone]).toBe(FIGURE_BONE.head);
  return { u: b[F.u]!, v: b[F.v]!, w: b[F.w]!, h: b[F.h]!, d: b[F.d]!, flags: b[F.flags]! };
}

describe('pintor do boneco: orientação pelo gêmeo da UV (E.6)', () => {
  // Ponto do FutBobo: coluna c e linha r de uma imagem 16×16 da face, como o `BoxGeometry` do three mapeia.
  const frontPoint = (c: number, r: number): number[] => [-0.5 + (c + 0.5) / 16, 0.5 - (r + 0.5) / 16, 0.5];
  const leftPoint = (c: number, r: number): number[] => [0.5, 0.5 - (r + 0.5) / 16, 0.5 - (c + 0.5) / 16];
  const rightPoint = (c: number, r: number): number[] => [-0.5, 0.5 - (r + 0.5) / 16, -0.5 + (c + 0.5) / 16];

  it('o nariz (pele −18 em (7, 10) do rosto) aparece na frente do boneco, em toda expressão', () => {
    const uv = headUv();
    expect(uv.flags & FIGURE_BOX_FLAG.face).not.toBe(0);
    for (const id of IDS) {
      const look = FIGURE_PRESETS[id];
      const { out } = paint({ look, team: -1, teamColors: [] });
      const nose = shade(look.skinTone, -18);
      for (const col of [7, 8]) {
        const hit = uvTwin(uv, frontPoint(col, 10));
        expect(hit.face, id).toBe(5);
        expect(rgbAt(out, 0, hit.u, hit.v), id).toBe(nose);
        // A flag `face` desloca a UV da frente (16, 16) para a célula da expressão.
        for (let e = 0; e < FACE_EXPRESSIONS.length; e++) {
          const u = hit.u - 16 + 16 * (e & 3);
          const v = hit.v - 16 + 32 + 16 * (e >> 2);
          expect(rgbAt(out, 0, u, v), `${id} expressão ${e}`).toBe(nose);
        }
      }
    }
  });

  it('o brinco "1" fica na −X do BF = +x do FutBobo = esquerda do boneco; a direita não tem brinco', () => {
    const uv = headUv();
    const look = FIGURE_PRESETS.trancas;
    expect(look.earrings).toBe(1);
    const { out } = paint({ look, team: -1, teamColors: [] });
    const gold = 0xe8c25a;
    const left = uvTwin(uv, leftPoint(7, 11));
    expect(left.face).toBe(1);
    expect(rgbAt(out, 0, left.u, left.v)).toBe(gold);
    let goldRight = 0;
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 16; c++) {
        const hit = uvTwin(uv, rightPoint(c, r));
        expect(hit.face).toBe(0);
        if (rgbAt(out, 0, hit.u, hit.v) === gold) goldRight++;
      }
    }
    expect(goldRight).toBe(0);
    // E no mundo: com a raiz em yaw 0, o +x do FutBobo na cabeça vai para −X (a esquerda de quem olha para −Z) e a
    // frente +z vai para −Z.
    const root = new Float32Array(16);
    figureRoot(root, 0, 0, 0, 0, 0, 1, 0);
    const bones = new Float32Array(FIGURE_BONES * 16);
    figureFk(FIGURE_REST_POSE, 0, root, 0, bones, 0);
    const h = FIGURE_BONE.head * 16;
    expect(bones[h]!).toBeLessThan(0); // coluna x do osso → mundo −X
    expect(bones[h + 10]!).toBeLessThan(0); // coluna z do osso → mundo −Z
  });

  /** UV da caixa `i` do corpo. */
  const bodyUv = (i: number): { u: number; v: number; w: number; h: number; d: number } => {
    const F = FIGURE_BOX_FIELD;
    const o = i * FIGURE_BOX_STRIDE;
    const b = FIGURE_BODY_BOXES;
    return { u: b[o + F.u]!, v: b[o + F.v]!, w: b[o + F.w]!, h: b[o + F.h]!, d: b[o + F.d]! };
  };

  it('bota de combate: sola embaixo e na linha de baixo dos lados; cadarço no topo, perto do bico (#58)', () => {
    const look = FIGURE_PRESETS.recruit;
    const { out } = paint({ look, team: -1, teamColors: [] });
    const boots = look.outfit.boots;
    const sole = mix(boots, 0x000000, 0.5);
    const lace = shade(boots, 40);
    for (const i of [10, 11]) {
      expect(FIGURE_BODY_BOXES[i * FIGURE_BOX_STRIDE + FIGURE_BOX_FIELD.bone]).toBe(
        i === 10 ? FIGURE_BONE.footR : FIGURE_BONE.footL,
      );
      const uv = bodyUv(i);
      // Topo (y = +0,5), da frente (+z do FutBobo) para trás: o bico, o cadarço e o couro (sem a biqueira do futebol).
      const top = [0.45, 0.2, -0.05, -0.3].map((z) => uvTwin(uv, [0, 0.5, z]));
      for (const t of top) expect(t.face).toBe(2);
      expect(top.map((t) => rgbAt(out, 1, t.u, t.v))).toEqual([boots, lace, boots, boots]);
      const bottom = uvTwin(uv, [0.2, -0.5, 0.3]);
      expect(bottom.face).toBe(3);
      expect(rgbAt(out, 1, bottom.u, bottom.v)).toBe(sole);
      // Lado e bico: o couro e a sola na linha de baixo.
      for (const q of [
        [0.5, 0.0, 0.1],
        [0.1, -0.1, 0.5],
      ]) {
        const hi = uvTwin(uv, q);
        const lo = uvTwin(uv, [q[0]!, -0.45, q[2]!]);
        expect(rgbAt(out, 1, hi.u, hi.v)).toBe(boots);
        expect(rgbAt(out, 1, lo.u, lo.v)).toBe(sole);
      }
    }
  });

  // Coluna c e linha r da imagem 16×24 de uma face do tronco (frente: +x, a esquerda do boneco, é a direita da imagem).
  const torsoPoint = (c: number, r: number, z: number): number[] => [-0.5 + (c + 0.5) / 16, 0.5 - (r + 0.5) / 24, z];

  it('o ícone do time fica no peito e nas costas, com a ponta do ▲ para cima; os porta-carregadores embaixo', () => {
    const uv = bodyUv(1);
    for (const [team, rows] of [
      // ▲ (time 0): ponta em cima, base embaixo; ◆ (time 3): ponta em cima e embaixo.
      [0, ['..#..', '..#..', '.###.', '.###.', '#####']],
      [3, ['..#..', '.###.', '#####', '.###.', '..#..']],
    ] as const) {
      const teams = [0xff7a1a, 0x2e8bff, 0x3ddc97, 0xa66bff];
      const { out } = paint({ look: FIGURE_PRESETS.classico, team, teamColors: teams });
      const tc = teams[team]!;
      const panel = detail(tc, 26);
      const ink = 0xffffff;
      // Frente pelo gêmeo da UV (a linha r da imagem cresce para baixo no boneco): o painel 7×7 em volta do ícone 5×5.
      const front = (c: number, r: number): number => {
        const hit = uvTwin(uv, torsoPoint(c, r, 0.5));
        expect(hit.face).toBe(5);
        return rgbAt(out, 1, hit.u, hit.v);
      };
      // Costas: a face de trás da cruz (u 32..47), lida direto (o ícone é simétrico; só a linha importa).
      const back = (c: number, r: number): number => rgbAt(out, 1, 32 + c, 8 + r);
      for (const at of [front, back]) {
        expect(at(4, 4)).toBe(panel);
        for (let y = 0; y < 5; y++)
          for (let x = 0; x < 5; x++) expect(at(5 + x, 5 + y), `time ${team}`).toBe(rows[y]![x] === '#' ? ink : panel);
        // A placa do colete na cor do time; o cinto do equipamento também.
        expect(at(1, 8)).toBe(tc);
        expect(at(1, 20)).toBe(tc);
      }
      // Frente: lapela e corpo dos porta-carregadores nas linhas 12..17 (x 1..4, 6..9 e 11..14).
      for (const c of [1, 6, 11]) {
        expect(front(c, 12)).toBe(detail(tc, 24));
        expect(front(c, 15)).toBe(detail(tc, 12));
      }
      expect(front(5, 15)).toBe(tc);
    }
  });
});

describe('pintor do boneco: conteúdo', () => {
  it('a frente da cruz (16, 16) é a expressão 0, e as 8 expressões são diferentes entre si', () => {
    for (const id of IDS) {
      const { out } = paint({ look: FIGURE_PRESETS[id], team: -1, teamColors: [] });
      const cells = new Set<string>();
      for (let e = 0; e < 8; e++) {
        const rows: number[] = [];
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 16; x++) rows.push(rgbAt(out, 0, 16 * (e & 3) + x, 32 + 16 * (e >> 2) + y));
        cells.add(rows.join(','));
      }
      expect(cells.size, id).toBe(8);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) expect(rgbAt(out, 0, 16 + x, 16 + y)).toBe(rgbAt(out, 0, x, 32 + y));
      }
    }
  });

  it('paleta: 16 amostras 4×4 uniformes; pele, cabelo e ouro do FutBobo; luva, manga, calça, colete e bota', () => {
    const look = FIGURE_PRESETS.trancas;
    const { out } = paint({ look, team: -1, teamColors: [] });
    const sample = (i: number): number => {
      const corner = figureSwatchCorner(i);
      const u0 = (corner % 64) - 2;
      const v0 = Math.floor(corner / 64) - 2;
      const c = rgbAt(out, 0, u0, v0);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) expect(rgbAt(out, 0, u0 + x, v0 + y), `amostra ${i}`).toBe(c);
      return c;
    };
    const S = FIGURE_SWATCH;
    const o = look.outfit;
    for (let i = 0; i < 16; i++) sample(i);
    expect(sample(S.skin)).toBe(look.skinTone);
    expect(sample(S.hair)).toBe(look.hairTop);
    expect(sample(S.hairBase)).toBe(look.hair);
    expect(sample(S.beard)).toBe(shade(look.hair, -6));
    expect(sample(S.accessory)).toBe(look.accessory);
    expect(sample(S.gold)).toBe(0xe8c25a);
    expect(sample(S.zombieGoo)).toBe(0x93ad57);
    expect(sample(S.hand)).toBe(o.gloves);
    expect(sample(S.sleeve)).toBe(o.jacket);
    expect(sample(S.pants)).toBe(o.pants);
    expect(sample(S.vest)).toBe(o.vest);
    expect(sample(S.vestShade)).toBe(shade(o.vest, -26));
    expect(sample(S.boots)).toBe(o.boots);
    // De mão nua (o mecânico): a mão do FutBobo, pele −10.
    const m = FIGURE_PRESETS.mechanic;
    const mo = paint({ look: m, team: -1, teamColors: [] }).out;
    const hc = figureSwatchCorner(S.hand);
    expect(rgbAt(mo, 0, hc % 64, Math.floor(hc / 64))).toBe(shade(m.skinTone, -10));
  });

  /** Amostra `i` da paleta. */
  const sw = (out: Uint8Array, i: number): number =>
    rgbAt(out, 0, figureSwatchCorner(i) % 64, Math.floor(figureSwatchCorner(i) / 64));
  /** As 12 linhas (com a calha) da coluna lida em `u` a partir de `v`. */
  const column = (out: Uint8Array, u: number, v: number): number[] =>
    Array.from({ length: 12 }, (_, r) => rgbAt(out, 1, u, v + r));

  it('time: colete, cinto, braçadeira, luvas e joelheiras do time; jaqueta e calça do look; acessório travado', () => {
    const look = normalizeFigureLook({ ...FIGURE_PRESETS.bandana, accessory: 0xff7a1a });
    const { out } = paint({ look, team: 1, teamColors: TEAMS });
    const B = TEAMS[1]!;
    const o = look.outfit;
    // Placa da frente (linha 6, x 2) e das costas, faixa lateral (linha 15 de +X), cinto (linha 20).
    expect(rgbAt(out, 1, 8 + 2, 8 + 6)).toBe(B);
    expect(rgbAt(out, 1, 32 + 14, 8 + 9)).toBe(B);
    expect(rgbAt(out, 1, 3, 8 + 15)).toBe(B);
    expect(rgbAt(out, 1, 8 + 2, 8 + 20)).toBe(B);
    // A jaqueta do look continua nas mangas (fora da braçadeira) e a calça na coxa.
    const sleeve = column(out, 50, 12);
    expect(sleeve.slice(0, 2)).toEqual([o.jacket, o.jacket]);
    expect(sleeve.slice(2, 7)).toEqual([detail(B, 24), B, B, B, detail(B, 24)]);
    expect(sleeve.slice(7)).toEqual(Array<number>(5).fill(o.jacket));
    expect(column(out, 58, 12)).toEqual(Array<number>(12).fill(o.pants));
    // Antebraço: a manga, a barra e o punho da luva do time; a mão (amostra) é a luva.
    const forearm = column(out, 54, 12);
    expect(forearm.slice(0, 7)).toEqual(Array<number>(7).fill(o.jacket));
    expect(forearm[7]).toBe(detail(o.jacket, 18));
    expect(forearm.slice(8)).toEqual([B, B, B, B]);
    expect(sw(out, FIGURE_SWATCH.hand)).toBe(B);
    // Canela: joelheira do time (3 + a borda), calça e a barra presa na bota.
    const shin = column(out, 50, 0);
    expect(shin.slice(0, 4)).toEqual([B, B, B, detail(B, 24)]);
    expect(shin.slice(4, 8)).toEqual(Array<number>(4).fill(o.pants));
    expect(shin.slice(8)).toEqual(Array<number>(4).fill(detail(o.pants, 24)));
    // Acessório laranja = time A da partida: travado em preto (paleta e bandana).
    expect(sw(out, FIGURE_SWATCH.accessory)).toBe(0x141414);
  });

  it('sem time: a farda do look (camuflado em volta de um colete menor, da cor dele, sem ícone nem braçadeira)', () => {
    const recruit = FIGURE_PRESETS.recruit;
    const r = paint({ look: recruit, team: -1, teamColors: TEAMS }).out;
    const camo = new Set(figureFabricTones(recruit.outfit.fabric, recruit.outfit.jacket));
    // Woodland nos lados do tronco acima da faixa do colete (linhas 0..9 de +X e −X): 4 tons, o principal entre eles.
    const tones = new Set<number>();
    for (const s of [0, 24])
      for (let x = 0; x < 8; x++) for (let y = 0; y < 10; y++) tones.add(rgbAt(r, 1, s + x, 8 + y));
    expect(tones.has(recruit.outfit.jacket)).toBe(true);
    expect(tones.size).toBeGreaterThanOrEqual(4);
    for (const c of tones) expect(camo.has(c)).toBe(true);
    // De frente, o colete do look é a placa menor (x 3..12, linhas 3..15): o woodland aparece dos lados (x 0..2 e 13..15).
    const sides = new Set<number>();
    for (let y = 3; y <= 15; y++) for (const x of [0, 1, 2, 13, 14, 15]) sides.add(rgbAt(r, 1, 8 + x, 8 + y));
    // (as pontas das lapelas dos bolsos do peito, na linha 4, também aparecem: o tom de costura da jaqueta)
    for (const c of sides) expect(camo.has(c) || c === detail(recruit.outfit.jacket, 22), c.toString(16)).toBe(true);
    expect(sides.size).toBeGreaterThanOrEqual(3);
    // Colete na cor do look; a tira de velcro sem ícone (6×2 de uma cor só); manga sem braçadeira; luva do look.
    const vest = recruit.outfit.vest;
    expect(rgbAt(r, 1, 8 + 7, 8 + 8)).toBe(vest);
    const panel = new Set<number>();
    for (let y = 5; y <= 6; y++) for (let x = 5; x <= 10; x++) panel.add(rgbAt(r, 1, 8 + x, 8 + y));
    expect([...panel]).toEqual([detail(vest, 26)]);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) expect(rgbAt(r, 1, 8 + x, 8 + y)).not.toBe(0xffffff);
    // Com time, o colete de time cobre a largura toda.
    expect(rgbAt(paint({ look: recruit, team: 0, teamColors: TEAMS }).out, 1, 8 + 1, 8 + 8)).toBe(TEAMS[0]);
    expect(column(r, 50, 12)).toEqual(Array<number>(12).fill(recruit.outfit.jacket));
    expect(sw(r, FIGURE_SWATCH.hand)).toBe(recruit.outfit.gloves);
    // Joelheira na cor do colete (o equipamento).
    expect(column(r, 50, 0)[0]).toBe(vest);
    // Piloto (macacão de voo, sem colete): a frente toda no tecido liso com o fecho no meio, cinto escuro e sem joelheira.
    const pilot = FIGURE_PRESETS.pilot;
    const p = paint({ look: pilot, team: -1, teamColors: TEAMS }).out;
    const j = pilot.outfit.jacket;
    expect(rgbAt(p, 1, 8 + 2, 8 + 10)).toBe(j);
    expect(rgbAt(p, 1, 8 + 8, 8 + 10)).toBe(detail(j, 22));
    expect(rgbAt(p, 1, 8 + 2, 8 + 20)).toBe(0x2d2c28);
    expect(column(p, 50, 0).slice(0, 8)).toEqual(Array<number>(8).fill(pilot.outfit.pants));
    expect(sw(p, FIGURE_SWATCH.hand)).toBe(pilot.outfit.gloves);
  });

  it('o uniforme de futebol saiu: sem número, escudo nem gola em V (só o tecido e as peças da farda na frente)', () => {
    for (const id of IDS) {
      if (id === 'zombie') continue;
      for (const team of [-1, 0, 1]) {
        const look = FIGURE_PRESETS[id];
        const { out } = paint({ look, team, teamColors: TEAMS });
        const o = look.outfit;
        const vest = team >= 0 ? TEAMS[team]! : o.vest;
        const allowed = new Set<number>([
          ...figureFabricTones(o.fabric, o.jacket),
          detail(o.jacket, 30),
          detail(o.jacket, 22),
          0x2d2c28,
          detail(0x2d2c28, 10),
          0x8f8d84,
          o.pants,
        ]);
        if (vest >= 0) {
          for (const k of [0, 12, 14, 24, 26]) allowed.add(detail(vest, k));
          allowed.add(mix(vest, 0xffffff, 0.14));
        }
        if (team >= 0) allowed.add(0xffffff).add(0x10271d);
        for (let y = 0; y < 24; y++) {
          for (let x = 0; x < 16; x++) {
            const c = rgbAt(out, 1, 8 + x, 8 + y);
            expect(allowed.has(c), `${id} time ${team} (${x}, ${y}) ${c.toString(16)}`).toBe(true);
          }
        }
      }
    }
  });

  it('cor do time na frente ≥ 35% da silhueta (arte-ux §2.4) nos 12 bonecos, nos 4 times', () => {
    // Projeção de frente do protótipo de pintura (1.356 t): a frente do tronco 16×24 texel a texel e os membros pela
    // área de frente de cada caixa (2 de cada; 2 t por px), linha a linha da coluna; as mãos pela amostra da luva.
    const teams = [0xff7a1a, 0x2e8bff, 0x3ddc97, 0xa66bff];
    const coverage = (look: FigureLook, team: number): number => {
      const { out } = paint({ look, team, teamColors: teams });
      const near = (rgb: number): boolean => figureColorDistance(rgb, teams[team]!) < 92;
      let n = 0;
      for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) if (near(rgbAt(out, 1, 8 + x, 8 + y))) n++;
      const limb = (u: number, v: number, rows: number, sx: number, sy: number): number => {
        let k = 0;
        for (let r = 0; r < rows; r++) if (near(rgbAt(out, 1, u, v + r))) k++;
        return 2 * (2 * sx) * ((2 * sy) / rows) * k;
      };
      n += limb(50, 12, 10, 4, 5.2); // manga
      n += limb(54, 12, 10, 3.6, 5); // antebraço
      n += limb(58, 12, 11, 4.25, 5.6); // coxa
      n += limb(50, 0, 10, 3.75, 4.9); // canela
      if (near(sw(out, FIGURE_SWATCH.hand))) n += 2 * (2 * 3.8) * (2 * 2.2);
      return n / 1356;
    };
    let min = 1;
    for (const id of [...IDS, 'padrao' as const]) {
      if (id === 'zombie') continue;
      const look = id === 'padrao' ? FIGURE_LOOK_DEFAULT : FIGURE_PRESETS[id];
      for (let team = 0; team < 4; team++) {
        const c = coverage(look, team);
        min = Math.min(min, c);
        expect(c, `${id} time ${team}`).toBeGreaterThanOrEqual(0.35);
      }
    }
    // O número medido (relatado no arte-ux §2.2): o pior caso é o ■ (25 t de tinta no peito e nas costas).
    expect(min).toBeCloseTo(COVERAGE_MIN, 3);
  });

  it('bota: célula na cor, a boca do cano mais clara, a sola mais escura na linha de baixo, o cadarço numa linha', () => {
    const look = FIGURE_PRESETS.recruit;
    const { out } = paint({ look, team: -1, teamColors: [] });
    const boots = look.outfit.boots;
    const sole = mix(boots, 0x000000, 0.5);
    const rects = boxCrossRects(53, 1, 1, 5, 4);
    for (const f of [0, 1, 4, 5]) {
      const r = rects[f]!;
      for (let u = r.u; u < r.u + r.w; u++) {
        for (let v = r.v; v < r.v + r.h; v++) {
          const want =
            v === r.v + r.h - 1
              ? sole
              : v === r.v
                ? shade(boots, 16)
                : f === 5 && v === r.v + 1
                  ? shade(boots, 40)
                  : boots;
          expect(rgbAt(out, 1, u, v), `face ${f} (${u}, ${v})`).toBe(want);
        }
      }
    }
    // Topo (57, 1..4): v cresce para a frente; o cadarço na linha 3, o bico na 4. Base toda em sola.
    expect([1, 2, 3, 4].map((v) => rgbAt(out, 1, 57, v))).toEqual([boots, boots, shade(boots, 40), boots]);
    expect([1, 2, 3, 4].map((v) => rgbAt(out, 1, 58, v))).toEqual([sole, sole, sole, sole]);
    expect(rgbAt(out, 1, 52, 0)).toBe(boots);
    expect(rgbAt(out, 1, 63, 11)).toBe(boots);
  });

  it('zumbi: pele verde, branco do olho amarelo, farda desbotada e rasgada, colunas com pele no fim', () => {
    const z = FIGURE_PRESETS.zombie;
    const { out } = paint({ look: z, team: -1, teamColors: [] });
    const skin = 0x8fae74;
    const kc = figureSwatchCorner(FIGURE_SWATCH.skin);
    expect(rgbAt(out, 0, kc % 64, Math.floor(kc / 64))).toBe(skin);
    // Olho do "normal" na célula 0: branco (3, 7) amarelado #dcbc5a (o estilo 0 é a espiral do outro olho).
    expect(rgbAt(out, 0, 10 + 2, 32 + 7)).toBe(0xdcbc5a);
    // Desbotada 35% para #8a8a86.
    const faded = (c: number): number => mix(c, 0x8a8a86, 0.35);
    const J = faded(z.outfit.jacket);
    const P = faded(z.outfit.pants);
    expect(sw(out, FIGURE_SWATCH.sleeve)).toBe(J);
    expect(sw(out, FIGURE_SWATCH.pants)).toBe(P);
    // Sem colete e sem ícone: o tronco só tem o woodland desbotado, a gola, o fecho, a pele (rasgos), a borda dos furos,
    // os curativos, o cinto e a calça.
    const tones = new Set(figureFabricTones(z.outfit.fabric, z.outfit.jacket).map(faded));
    for (let y = 2; y <= 10; y++)
      for (let x = 0; x < 16; x++) {
        const c = rgbAt(out, 1, 32 + x, 8 + y);
        expect(tones.has(c) || c === detail(J, 22) || c === detail(J, 30) || c === skin || c === shade(skin, -28)).toBe(
          true,
        );
      }
    // Colunas: manga com 9 linhas de roupa e pele depois; antebraço com 6; coxa com 10 (u lido = 50, 54, 58).
    expect(column(out, 50, 12)).toEqual([...Array<number>(9).fill(J), skin, skin, skin]);
    expect(column(out, 54, 12)).toEqual([...Array<number>(6).fill(J), ...Array<number>(6).fill(skin)]);
    expect(column(out, 58, 12)).toEqual([...Array<number>(10).fill(P), skin, skin]);
    // A mão é nua (verde, −10) e a canela é a calça desbotada com a barra.
    expect(sw(out, FIGURE_SWATCH.hand)).toBe(shade(skin, -10));
    expect(column(out, 50, 0).slice(0, 8)).toEqual(Array<number>(8).fill(P));
  });
});
