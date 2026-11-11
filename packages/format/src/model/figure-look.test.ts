import { describe, expect, it } from 'vitest';
import { isKnownContentId } from '../content-ids.ts';
import {
  FIGURE_FABRIC,
  FIGURE_FABRICS,
  FIGURE_LOCK_DARK,
  FIGURE_LOCK_LIGHT,
  FIGURE_LOOK_DEFAULT,
  figureColorDistance,
  figureLockedColor,
  figureOutfitFor,
  figureSkinKey,
  figureTeamColor,
  normalizeFigureLook,
  type FigureLook,
} from './figure-look.ts';
import { FIGURE_BOT_ROTATION, FIGURE_PRESETS, type FigurePresetId } from './figure-presets.ts';

/** Cores dos times (`ui/tokens.ts`), em RGB. */
const TEAM_A = 0xff7a1a;
const TEAM_B = 0x2e8bff;
const TEAM_C = 0x3ddc97;
const TEAM_D = 0xa66bff;

describe('aparência do boneco: normalizador (só clamp, sem ramo legado)', () => {
  it('vazio = padrão; o padrão já está normalizado; lixo de save (null, número) = padrão', () => {
    expect(normalizeFigureLook({})).toEqual(FIGURE_LOOK_DEFAULT);
    expect(normalizeFigureLook(FIGURE_LOOK_DEFAULT)).toEqual(FIGURE_LOOK_DEFAULT);
    for (const junk of [null, undefined, 7, 'x'])
      expect(normalizeFigureLook(junk as unknown as Partial<FigureLook>)).toEqual(FIGURE_LOOK_DEFAULT);
  });

  it('arredonda e clampa índices na faixa das listas do FutBobo; não remapeia nada (os 8 visuais ficam)', () => {
    const look = normalizeFigureLook({
      hairStyle: 99,
      face: -3,
      brow: 2.6,
      beard: 11,
      faceMark: 6,
      headwear: 4,
      eyewear: 7,
      earrings: 3,
    });
    expect([look.hairStyle, look.face, look.brow, look.beard, look.faceMark]).toEqual([33, 0, 3, 11, 5]);
    expect([look.headwear, look.eyewear, look.earrings]).toEqual([4, 3, 3]);
    // Visual 4 do teste (dreads, sobrancelha Grossa): o ramo legado do FutBobo viraria corte 2 e sobrancelha 2.
    const dreads = normalizeFigureLook({ hairStyle: 9, brow: 4, face: 1, beard: 2 });
    expect([dreads.hairStyle, dreads.brow, dreads.face, dreads.beard]).toEqual([9, 4, 1, 2]);
  });

  it('RGB em 0..0xffffff; ausente, NaN ou não número = padrão; topo do cabelo segue o cabelo', () => {
    const look = normalizeFigureLook({ skinTone: 0x1ffffff, hair: -5, eyes: Number.NaN, accessory: 0xc4723f });
    expect(look.skinTone).toBe(0xffffff);
    expect(look.hair).toBe(0);
    expect(look.hairTop).toBe(0);
    expect(look.eyes).toBe(FIGURE_LOOK_DEFAULT.eyes);
    expect(look.accessory).toBe(0xc4723f);
    expect(normalizeFigureLook({ hair: 0x985d43, hairTop: 0xeee5c9 }).hairTop).toBe(0xeee5c9);
    const junk = { skinTone: '#ffffff' } as unknown as Partial<FigureLook>;
    expect(normalizeFigureLook(junk).skinTone).toBe(FIGURE_LOOK_DEFAULT.skinTone);
  });

  it('Descolorido (corte 11) sem topo próprio: o topo é #eee5c9, como o resolveLook do FutBobo', () => {
    expect(normalizeFigureLook({ hairStyle: 11, hair: 0x985d43 }).hairTop).toBe(0xeee5c9);
    expect(normalizeFigureLook({ hairStyle: 11, hair: 0x985d43, hairTop: 0x123456 }).hairTop).toBe(0x123456);
  });

  it('farda (#58): tecido 0..5, RGB das peças, colete e luvas −1 = sem; campo inválido = padrão', () => {
    expect(Object.values(FIGURE_FABRIC)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(FIGURE_FABRICS).toBe(9);
    const outfit = normalizeFigureLook({
      outfit: { fabric: 4.4, jacket: 0x586a4b, pants: 0x1ffffff, vest: -1, boots: 0x141414, gloves: -7 },
    }).outfit;
    expect(outfit).toEqual({ fabric: 4, jacket: 0x586a4b, pants: 0xffffff, vest: -1, boots: 0x141414, gloves: -1 });
    expect(normalizeFigureLook({ outfit: { ...outfit, fabric: 99 } }).outfit.fabric).toBe(8);
    expect(normalizeFigureLook({ outfit: { ...outfit, fabric: -2, jacket: -5 } }).outfit).toMatchObject({
      fabric: 0,
      jacket: 0,
    });
    const partial = { outfit: { fabric: 2 } } as unknown as Partial<FigureLook>;
    expect(normalizeFigureLook(partial).outfit).toEqual({ ...FIGURE_LOOK_DEFAULT.outfit, fabric: 2 });
    const junk = { outfit: { vest: 'preto', gloves: Number.NaN } } as unknown as Partial<FigureLook>;
    expect(normalizeFigureLook(junk).outfit).toEqual(FIGURE_LOOK_DEFAULT.outfit);
    // O uniforme de futebol saiu: o look não tem mais `kit` (um save antigo com `kit` cai na farda padrão).
    const old = { kit: { pattern: 3, primary: 0xff0000 } } as unknown as Partial<FigureLook>;
    expect('kit' in normalizeFigureLook(old)).toBe(false);
    expect(normalizeFigureLook(old).outfit).toEqual(FIGURE_LOOK_DEFAULT.outfit);
  });

  it('zumbi: tipo conhecido ou `common`, estilo de rosto 0..7; null fica null', () => {
    expect(normalizeFigureLook({ zombie: null }).zombie).toBeNull();
    expect(normalizeFigureLook({ zombie: { kind: 'mega', faceStyle: 9 } }).zombie).toEqual({
      kind: 'mega',
      faceStyle: 7,
    });
    const junk = { zombie: { kind: 'vampiro', faceStyle: 2 } } as unknown as Partial<FigureLook>;
    expect(normalizeFigureLook(junk).zombie).toEqual({ kind: 'common', faceStyle: 2 });
  });

  it('acessórios 3D: a chave só existe com id não vazio (exactOptionalPropertyTypes)', () => {
    expect('hat3d' in normalizeFigureLook({})).toBe(false);
    expect(normalizeFigureLook({ hat3d: 'cap', back: '' })).toEqual({ ...FIGURE_LOOK_DEFAULT, hat3d: 'cap' });
  });
});

describe('cor de time: distância, trava e farda efetiva (PLANO §B7, #58)', () => {
  it('redmean = a kitDistance do FutBobo (simétrica, 0 na mesma cor; A × B do estudo de pintura §7.3)', () => {
    expect(figureColorDistance(TEAM_A, TEAM_A)).toBe(0);
    expect(figureColorDistance(TEAM_A, TEAM_B)).toBeCloseTo(figureColorDistance(TEAM_B, TEAM_A), 9);
    // Tabela do estudo: A × B 490, C × A 417, C × B 239, D × A 370, D × B 197.
    expect(Math.round(figureColorDistance(TEAM_A, TEAM_B))).toBe(490);
    expect(Math.round(figureColorDistance(TEAM_C, TEAM_A))).toBe(417);
    expect(Math.round(figureColorDistance(TEAM_C, TEAM_B))).toBe(239);
    expect(Math.round(figureColorDistance(TEAM_D, TEAM_A))).toBe(370);
    expect(Math.round(figureColorDistance(TEAM_D, TEAM_B))).toBe(197);
  });

  it('trava: as 4 cores do FutBobo a < 92 de um time viram #141414; longe de todos, passam; time preto → branco', () => {
    const match = [TEAM_A, TEAM_B, TEAM_C];
    // Acessório laranja (= time A), chuteira laranja (75 de A), azul (32 de B) e verde da semente 7 (35 de C).
    for (const c of [0xff7a1a, 0xff5a36, 0x2f7bff, 0x2fd38a])
      expect(figureLockedColor(c, match)).toBe(FIGURE_LOCK_DARK);
    for (const c of [0x141414, 0xf4f4f2, 0xd7263d, 0xffd23f, 0x7b3fd1]) expect(figureLockedColor(c, match)).toBe(c);
    expect(figureLockedColor(0xff7a1a, [])).toBe(0xff7a1a);
    expect(figureLockedColor(0x202020, [0x1c1f26])).toBe(FIGURE_LOCK_LIGHT);
    // Sem a peça (−1) passa.
    expect(figureLockedColor(-1, match)).toBe(-1);
  });

  it('cor do time: só 0..n − 1 da partida; −1, 255 e fora da lista = sem time', () => {
    expect(figureTeamColor(1, [TEAM_A, TEAM_B])).toBe(TEAM_B);
    for (const t of [-1, 255, 2, 0.5]) expect(figureTeamColor(t, [TEAM_A, TEAM_B])).toBe(-1);
  });

  it('com time: colete e luvas na cor do time (mesmo sem colete e de mão nua); tecido, jaqueta, calça e botas do look', () => {
    const teams = [TEAM_A, TEAM_B];
    for (const id of ['recruit', 'mechanic'] as const) {
      const o = FIGURE_PRESETS[id].outfit;
      expect(figureOutfitFor(FIGURE_PRESETS[id], 1, teams), id).toEqual({
        fabric: o.fabric,
        jacket: o.jacket,
        pants: o.pants,
        vest: TEAM_B,
        boots: o.boots,
        gloves: TEAM_B,
      });
    }
    expect(FIGURE_PRESETS.mechanic.outfit.vest).toBe(-1);
    expect(FIGURE_PRESETS.mechanic.outfit.gloves).toBe(-1);
  });

  it('trava: jaqueta, calça, colete, luvas e botas do look perto de um time viram #141414, com ou sem time', () => {
    const teams = [TEAM_A, TEAM_B, TEAM_C];
    const look = normalizeFigureLook({
      outfit: { fabric: 1, jacket: 0xff7a1a, pants: 0x2f7bff, vest: 0x2fd38a, boots: 0xff5a36, gloves: 0x3ddc97 },
    });
    expect(figureOutfitFor(look, -1, teams)).toEqual({
      fabric: 1,
      jacket: FIGURE_LOCK_DARK,
      pants: FIGURE_LOCK_DARK,
      vest: FIGURE_LOCK_DARK,
      boots: FIGURE_LOCK_DARK,
      gloves: FIGURE_LOCK_DARK,
    });
    // Com time, colete e luvas são do time (sem trava); o resto continua travado.
    expect(figureOutfitFor(look, 2, teams)).toMatchObject({ jacket: FIGURE_LOCK_DARK, vest: TEAM_C, gloves: TEAM_C });
    // Sem times na partida, nada trava.
    expect(figureOutfitFor(look, -1, [])).toBe(look.outfit);
  });

  it('sem time (−1, 255 ou fora da partida): a farda do look (o mesmo objeto quando nada trava)', () => {
    for (const id of Object.keys(FIGURE_PRESETS) as FigurePresetId[]) {
      const look = FIGURE_PRESETS[id];
      expect(figureOutfitFor(look, -1, [TEAM_A, TEAM_B, TEAM_C, TEAM_D]), id).toBe(look.outfit);
      expect(figureOutfitFor(look, 255, []), id).toBe(look.outfit);
      expect(figureOutfitFor(look, 2, [TEAM_A, TEAM_B]), id).toBe(look.outfit);
    }
  });
});

describe('chave da skin', () => {
  it('estável, muda com o que pinta e com o time; ignora os acessórios 3D', () => {
    const look = FIGURE_PRESETS.trancas;
    const teams = [TEAM_A, TEAM_B];
    const key = figureSkinKey({ look, team: 0, teamColors: teams });
    expect(figureSkinKey({ look, team: 0, teamColors: [TEAM_A, TEAM_B] })).toBe(key);
    expect(figureSkinKey({ look, team: 1, teamColors: teams })).not.toBe(key);
    expect(figureSkinKey({ look, team: -1, teamColors: teams })).not.toBe(key);
    expect(figureSkinKey({ look: { ...look, hairStyle: 7 }, team: 0, teamColors: teams })).not.toBe(key);
    expect(figureSkinKey({ look: { ...look, brow: 3 }, team: 0, teamColors: teams })).not.toBe(key);
    expect(figureSkinKey({ look: { ...look, hat3d: 'cap' }, team: 0, teamColors: teams })).toBe(key);
  });

  it('receitas que pintam igual dividem a chave: −1 = 255; colete e luvas do look não contam com time; trava', () => {
    const look = FIGURE_PRESETS.classico;
    const teams = [TEAM_A, TEAM_B];
    expect(figureSkinKey({ look, team: -1, teamColors: teams })).toBe(
      figureSkinKey({ look, team: 255, teamColors: teams }),
    );
    const other = { ...look, outfit: { ...look.outfit, vest: 0x123456, gloves: -1 } };
    expect(figureSkinKey({ look: other, team: 0, teamColors: teams })).toBe(
      figureSkinKey({ look, team: 0, teamColors: teams }),
    );
    expect(figureSkinKey({ look: other, team: -1, teamColors: teams })).not.toBe(
      figureSkinKey({ look, team: -1, teamColors: teams }),
    );
    // A jaqueta do look aparece com time: muda a chave.
    const jacket = { ...look, outfit: { ...look.outfit, jacket: 0x123456 } };
    expect(figureSkinKey({ look: jacket, team: 0, teamColors: teams })).not.toBe(
      figureSkinKey({ look, team: 0, teamColors: teams }),
    );
    // O ícone é do time: dois times com a mesma cor não dividem a skin.
    expect(figureSkinKey({ look, team: 0, teamColors: [TEAM_A, TEAM_A] })).not.toBe(
      figureSkinKey({ look, team: 1, teamColors: [TEAM_A, TEAM_A] }),
    );
    // Acessório laranja e branco: com o time A na partida, o laranja trava em preto (≠ do branco); sem times, passa.
    const orange = { ...look, accessory: 0xff7a1a };
    expect(figureSkinKey({ look: orange, team: -1, teamColors: teams })).toBe(
      figureSkinKey({ look: { ...look, accessory: FIGURE_LOCK_DARK }, team: -1, teamColors: teams }),
    );
    expect(figureSkinKey({ look: orange, team: -1, teamColors: [] })).not.toBe(
      figureSkinKey({ look: { ...look, accessory: FIGURE_LOCK_DARK }, team: -1, teamColors: [] }),
    );
  });

  it('os 20 looks prontos (12 + 4 fantasias, fase 6d, + 4 especiais do Zombies, M3 fase 5b) têm chaves distintas, e o zumbi muda com o estilo e o tipo', () => {
    const keys = new Set(
      (Object.keys(FIGURE_PRESETS) as FigurePresetId[]).map((id) =>
        figureSkinKey({ look: FIGURE_PRESETS[id], team: -1, teamColors: [] }),
      ),
    );
    expect(keys.size).toBe(20);
    const z = FIGURE_PRESETS.zombie;
    const key = (look: FigureLook): string => figureSkinKey({ look, team: -1, teamColors: [] });
    expect(key({ ...z, zombie: { kind: 'common', faceStyle: 3 } })).not.toBe(key(z));
    expect(key({ ...z, zombie: { kind: 'chonker', faceStyle: 0 } })).not.toBe(key(z));
  });
});

describe('aparências prontas e rotação dos bots', () => {
  it('um look por id, já normalizado e com id de conteúdo; só os zumbis são zumbi', () => {
    const ids = Object.keys(FIGURE_PRESETS) as FigurePresetId[];
    expect(ids).toHaveLength(20);
    for (const id of ids) {
      expect(normalizeFigureLook(FIGURE_PRESETS[id])).toEqual(FIGURE_PRESETS[id]);
      expect(isKnownContentId(`skin:${id}`), id).toBe(true);
      expect(FIGURE_PRESETS[id].zombie === null, id).toBe(!id.startsWith('zombie'));
    }
    // M3 (fase 5b): cada especial com o tipo dele.
    expect(FIGURE_PRESETS['zombie-sprinter'].zombie?.kind).toBe('sprinter');
    expect(FIGURE_PRESETS['zombie-chonker'].zombie?.kind).toBe('chonker');
    expect(FIGURE_PRESETS['zombie-spitter'].zombie?.kind).toBe('spitter');
    expect(FIGURE_PRESETS['zombie-mega'].zombie?.kind).toBe('mega');
    expect(FIGURE_PRESETS.zombie.zombie).toEqual({ kind: 'common', faceStyle: 0 });
    expect(FIGURE_PRESETS.zombie.skinTone).toBe(0x8fae74);
    expect([FIGURE_PRESETS.zombie.outfit.vest, FIGURE_PRESETS.zombie.outfit.gloves]).toEqual([-1, -1]);
  });

  it('roupa militar (#58): nenhuma peça dos 12 looks trava contra as 4 cores de time', () => {
    const teams = [TEAM_A, TEAM_B, TEAM_C, TEAM_D];
    for (const id of Object.keys(FIGURE_PRESETS) as FigurePresetId[]) {
      const o = FIGURE_PRESETS[id].outfit;
      for (const c of [o.jacket, o.pants, o.vest, o.boots, o.gloves]) {
        if (c >= 0) expect(figureLockedColor(c, teams), `${id} ${c.toString(16)}`).toBe(c);
      }
    }
  });

  it('os 8 visuais são os do teste aprovado (cabecas/src/main.ts:30-61, version 2), com as cores do FutBobo', () => {
    // [pele, cabelo, olhos, corte, rosto, barba, sobrancelha, marca, chapéu, acessório, brinco] (RGB das listas).
    const expected: Record<string, readonly number[]> = {
      classico: [0xe5aa84, 0x12110f, 0x35251d, 0, 0, 0, 1, 0, 0, 0xf4f4f2, 0],
      blackpower: [0x985d43, 0x12110f, 0x111816, 4, 2, 7, 2, 0, 0, 0xf4f4f2, 0],
      sardento: [0xf6d9c0, 0xbd8654, 0x31505b, 1, 4, 0, 0, 1, 0, 0xf4f4f2, 0],
      dreads: [0xcc8965, 0x473023, 0x765139, 9, 1, 2, 4, 0, 0, 0xf4f4f2, 0],
      bandana: [0x4b3027, 0x12110f, 0x35251d, 12, 3, 1, 2, 0, 3, 0xd7263d, 0],
      moicano: [0xd99b73, 0xcf6f38, 0x49633c, 3, 10, 3, 3, 0, 0, 0xf4f4f2, 0],
      barbudo: [0xedbf9d, 0xded8cc, 0x7c8f98, 25, 0, 8, 1, 0, 0, 0xf4f4f2, 0],
      trancas: [0xbd7b58, 0x28201b, 0x111816, 6, 9, 0, 0, 0, 1, 0xf4f4f2, 1],
    };
    for (const [id, e] of Object.entries(expected)) {
      const l = FIGURE_PRESETS[id as FigurePresetId];
      const got = [
        l.skinTone,
        l.hair,
        l.eyes,
        l.hairStyle,
        l.face,
        l.beard,
        l.brow,
        l.faceMark,
        l.headwear,
        l.accessory,
        l.earrings,
      ];
      expect(got, id).toEqual(e);
      expect(l.hairTop, id).toBe(l.hair);
      expect(l.eyewear, id).toBe(0);
    }
    // Fardas variadas (#58): as 8 diferentes entre si, com pelo menos 4 tecidos e todas de colete.
    const outfits = Object.keys(expected).map((id) => FIGURE_PRESETS[id as FigurePresetId].outfit);
    expect(new Set(outfits.map((o) => JSON.stringify(o))).size).toBe(8);
    expect(new Set(outfits.map((o) => o.fabric)).size).toBeGreaterThanOrEqual(4);
    for (const o of outfits) expect(o.vest).toBeGreaterThanOrEqual(0);
  });

  it('prontas do §B15 e da #58: recruta woodland, mecânico de macacão com graxa, piloto de macacão de voo', () => {
    const r = FIGURE_PRESETS.recruit;
    expect([r.hairStyle, r.face, r.brow, r.beard, r.headwear, r.outfit.fabric]).toEqual([
      5,
      0,
      1,
      0,
      0,
      FIGURE_FABRIC.woodland,
    ]);
    expect(r.outfit.vest).toBeGreaterThanOrEqual(0);
    const m = FIGURE_PRESETS.mechanic;
    expect([m.hairStyle, m.beard, m.headwear, m.accessory, m.outfit.fabric, m.outfit.vest]).toEqual([
      24,
      3,
      4,
      0xc4723f,
      FIGURE_FABRIC.grease,
      -1,
    ]);
    // Macacão: jaqueta = calça.
    expect(m.outfit.jacket).toBe(m.outfit.pants);
    const p = FIGURE_PRESETS.pilot;
    expect([p.hairStyle, p.eyewear, p.accessory, p.outfit.fabric, p.outfit.vest, p.outfit.gloves]).toEqual([
      0,
      1,
      0x4a2e2e,
      FIGURE_FABRIC.plain,
      -1,
      0x4a2e2e,
    ]);
    expect(p.outfit.jacket).toBe(p.outfit.pants);
    // Todos os tecidos aparecem em algum pronto.
    const fabrics = new Set(Object.values(FIGURE_PRESETS).map((l) => l.outfit.fabric));
    expect([...fabrics].sort()).toEqual(Object.values(FIGURE_FABRIC));
  });

  it('rotação na ordem do PLANO §B15, sem o zumbi e sem repetir', () => {
    expect(FIGURE_BOT_ROTATION).toEqual([
      'recruit',
      'mechanic',
      'pilot',
      'classico',
      'blackpower',
      'dreads',
      'sardento',
      'bandana',
      'moicano',
      'barbudo',
      'trancas',
    ]);
    expect(new Set(FIGURE_BOT_ROTATION).size).toBe(FIGURE_BOT_ROTATION.length);
  });
});
