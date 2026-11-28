import {
  BUTTON,
  BUTTON_COMPACT,
  COLORS,
  createDrawList,
  DRAW_FLOATS_PER_COMMAND,
  drawTree,
  layoutTree,
  MIN_TEXT,
  MIN_TOUCH_TARGET,
  parseFontPack,
  type ButtonNode,
  type UiNode,
} from '@boboforces/ui';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cascadeResult,
  RESULT_ACTION,
  resultScreen,
  zombiesResultScreen,
  type ResultScreenData,
} from './result-screen.ts';

/** M2, fase 5e: os botões do resultado que levam ao Laboratório. */

const base: ResultScreenData = {
  title: 'Derrota',
  titleColor: COLORS.perigo,
  own: 10,
  other: 30,
  mvp: 'Tryhard Bob',
  nemesis: 'Tryhard Bob',
  nemesisKills: 5,
  victim: '',
  victimKills: 0,
  kills: 3,
  accuracy: '20%',
  bestStreak: 1,
  prizes: [],
  level: 'Tryhard',
  canEasier: true,
  canHarder: false,
  focusEasier: true,
};

function find(node: UiNode, id: string): ButtonNode | null {
  if (node.id === id && node.kind === 'button') return node;
  const kids = 'children' in node && node.children ? node.children : [];
  for (const k of kids) {
    const hit = find(k, id);
    if (hit) return hit;
  }
  return null;
}

describe('resultado: pontes do Laboratório', () => {
  it('no Tryhard, "Mais difícil" vira "Abrir Laboratório"; o Nêmesis salva uma vez', () => {
    const plain = resultScreen.build(base);
    expect(find(plain, 'harder')).toMatchObject({ action: RESULT_ACTION.harder, disabled: true });
    expect(find(plain, 'saveWorkshop')).toMatchObject({ disabled: false, text: { key: 'result.saveWorkshop' } });
    const tryhard = resultScreen.build({ ...base, openLab: true, nemesisSaved: true });
    expect(find(tryhard, 'harder')).toMatchObject({ action: RESULT_ACTION.lab, text: { key: 'result.openLab' } });
    expect(find(tryhard, 'harder')!.disabled).toBeFalsy();
    expect(find(tryhard, 'saveWorkshop')).toMatchObject({ disabled: true, text: { key: 'result.nemesisSaved' } });
  });
});

describe('M3 (fase 6a): resultado do Bobo Zombies', () => {
  it('tabela por bobo, sem Nêmesis nem nível; o preset salva uma vez', () => {
    const data = {
      title: 'Caíram na onda 7',
      titleColor: COLORS.perigo,
      config: 'Base Abandonada · 10 ondas · 2 jogadores',
      record: 'Novo recorde! Antes: onda 5',
      newRecord: true,
      rows: [
        { name: 'P1', color: COLORS.acao, points: 4210, kills: 38, headKills: 12, downs: 1, revives: 2 },
        { name: 'P2', color: COLORS.texto, points: 3100, kills: 30, headKills: 5, downs: 2, revives: 1 },
      ],
    };
    const root = zombiesResultScreen.build(data);
    const text = JSON.stringify(root);
    expect(text).toContain('4210');
    expect(text).toContain('Levantou');
    expect(find(root, 'saveWorkshop')).toBeNull();
    expect(find(root, 'harder')).toBeNull();
    expect(find(root, 'again')).toMatchObject({ action: RESULT_ACTION.again, autofocus: true });
    expect(find(root, 'changeRules')).toMatchObject({ action: RESULT_ACTION.changeRules });
    const saved = zombiesResultScreen.build({ ...data, presetSaved: true });
    expect(find(saved, 'savePreset')).toMatchObject({ disabled: true, text: { key: 'result.presetSaved' } });
  });
});

describe('M5 (fase 4c): resultado de uma partida online', () => {
  it('só Voltar à sala (a próxima partida o host escolhe na sala), no Warfare e no Bobo Zombies', () => {
    for (const tree of [
      resultScreen.build({ ...base, online: true }),
      zombiesResultScreen.build({
        title: 'Caíram na onda 7',
        titleColor: COLORS.perigo,
        config: 'Base · 10 ondas · 2 jogadores',
        record: 'Primeira partida nesta configuração',
        newRecord: false,
        rows: [],
        online: true,
      }),
    ]) {
      expect(find(tree, 'quit')).toMatchObject({ action: RESULT_ACTION.quit, text: { key: 'result.backToRoom' } });
      for (const id of ['again', 'easier', 'harder', 'changeRules', 'savePreset']) expect(find(tree, id)).toBeNull();
    }
  });
});

describe('M7 (fase 9): o resultado do Aquário só assistido', () => {
  const ids = (node: UiNode, out: string[] = []): string[] => {
    if (node.id !== undefined) out.push(node.id);
    const kids = 'children' in node && node.children ? node.children : [];
    for (const k of kids) ids(k, out);
    return out;
  };

  it('sem Nêmesis, Freguês e os seus números; com o placar vazio, sem a linha do placar', () => {
    const watched = ids(resultScreen.build({ ...base, title: 'Vitória do time Azul', watching: true }));
    expect(watched).toContain('score');
    expect(watched).toContain('mvp');
    for (const id of ['nemesis', 'nemesisRow', 'victim', 'numbersTitle', 'numbers']) expect(watched).not.toContain(id);
    const ffa = ids(resultScreen.build({ ...base, watching: true, scoreLine: '' }));
    expect(ffa).not.toContain('score');
    // Jogando, tudo como antes.
    const played = ids(resultScreen.build(base));
    for (const id of ['score', 'nemesisRow', 'victim', 'numbers']) expect(played).toContain(id);
  });
});

describe('M8 (fase 4): a rivalidade no resultado', () => {
  it('embaixo do Nêmesis, quando ele é o rival guardado', () => {
    const find = (node: UiNode, id: string): UiNode | null => {
      if (node.id === id) return node;
      const kids = 'children' in node && node.children ? node.children : [];
      for (const k of kids) {
        const hit = find(k, id);
        if (hit) return hit;
      }
      return null;
    };
    const tree = resultScreen.build({ ...base, rivalry: 'Na rivalidade: te pegou 12, você 4 · 3 partidas' });
    expect(find(tree, 'rivalry')).toMatchObject({
      text: { literal: 'Na rivalidade: te pegou 12, você 4 · 3 partidas' },
    });
    expect(find(resultScreen.build(base), 'rivalry')).toBeNull();
  });
});

describe('M12 (fase 2): o resultado com respiro', () => {
  const buttons = (node: UiNode, out: ButtonNode[] = []): ButtonNode[] => {
    if (node.kind === 'button') out.push(node);
    const kids = 'children' in node && node.children ? node.children : [];
    for (const k of kids) buttons(k, out);
    return out;
  };

  it('travado: todos os botões desligados (e sem foco inicial); destravado, como antes', () => {
    for (const tree of [
      resultScreen.build({ ...base, locked: true }),
      resultScreen.build({ ...base, locked: true, online: true }),
      zombiesResultScreen.build({
        title: 'x',
        titleColor: COLORS.texto,
        config: '',
        record: '',
        newRecord: false,
        rows: [],
        locked: true,
      }),
    ]) {
      const bs = buttons(tree);
      expect(bs.length).toBeGreaterThan(0);
      for (const b of bs) expect([b.id, b.disabled, b.autofocus]).toEqual([b.id, true, false]);
    }
    expect(find(resultScreen.build(base), 'again')!.disabled).toBeFalsy();
  });

  it('o MVP em âmbar quando é você; o placar de times diz qual é o seu; o Salvar na Oficina compacto ao lado do Nêmesis', () => {
    const tree = resultScreen.build({ ...base, mvpIsYou: true, teamScore: true });
    const json = JSON.stringify(tree);
    expect(json).toContain(
      `"id":"mvp","text":{"key":"result.mvp","params":{"name":"Tryhard Bob"}},"style":"body","color":${COLORS.acao}`,
    );
    expect(json).toContain('"key":"result.scoreTeam"');
    const kidsOf = (n: UiNode): readonly UiNode[] => ('children' in n && n.children ? n.children : []);
    const row = kidsOf(kidsOf(tree)[0]!).find((c) => c.id === 'nemesisRow')!;
    expect(find(row, 'saveWorkshop')).toMatchObject({ compact: true });
    expect(find(resultScreen.build({ ...base, watching: true }), 'saveWorkshop')).toBeNull();
  });

  it('cascata: no começo tudo apagado; aos 100 ms as linhas de cima já entram e as de baixo não; com Reduzir, nada muda', () => {
    const root = resultScreen.build(base);
    const layout = layoutTree(root, { x: 0, y: 0, w: 1280, h: 720 });
    const draw = (ageMs: number, reduce: boolean) => {
      const list = createDrawList();
      list.width = 1280;
      list.height = 720;
      drawTree(layout, null, list);
      cascadeResult(list, 0, layout, ageMs, 1, reduce);
      return list;
    };
    const alphaAt = (list: ReturnType<typeof createDrawList>, i: number): number => list.colors[i]! & 0xff;
    const start = draw(0, false);
    for (let i = 0; i < start.count; i++) expect(alphaAt(start, i)).toBe(0);
    const mid = draw(100, false);
    const full = draw(100, true);
    // O véu (o 1º comando, do tamanho da tela) já entrou; o último botão (lá embaixo) ainda não.
    expect(alphaAt(mid, 0)).toBeGreaterThan(0);
    let lowest = 0;
    for (let i = 1; i < mid.count; i++)
      if (mid.geom[i * DRAW_FLOATS_PER_COMMAND + 1]! > mid.geom[lowest * DRAW_FLOATS_PER_COMMAND + 1]!) lowest = i;
    expect(alphaAt(mid, lowest)).toBe(0);
    for (let i = 0; i < full.count; i++) expect(full.colors[i]).toBe(draw(10_000, false).colors[i]);
  });
});

describe('M12 (fase 2, revisão): o resultado cabe na tela com o atlas real', () => {
  const ROOT = resolve(import.meta.dirname, '..', '..', '..');
  const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
    files: Record<string, string>;
  };
  const fonts = parseFontPack(
    JSON.parse(readFileSync(join(ROOT, 'assets-src', RUNTIME.files['fonts/ui-fonts.json'] as string), 'utf8')),
  ).fonts;
  const TARGETS = [
    ['web 1280×720', 1280, 720, MIN_TEXT.phone, 0],
    ['web 640×360', 640, 360, MIN_TEXT.phone, 0],
    ['toque 640×360', 640, 360, MIN_TEXT.phone, MIN_TOUCH_TARGET],
    ['celular 1334×750 (DPR 2)', 1334, 750, MIN_TEXT.phone * 2, MIN_TOUCH_TARGET * 2],
    ['4:3 1024×768', 1024, 768, MIN_TEXT.phone, 0],
    ['Switch 1280×720', 1280, 720, MIN_TEXT.tv, 0],
    ['Switch 4:3 960×720', 960, 720, MIN_TEXT.tv, 0],
  ] as const;
  const full: ResultScreenData = {
    ...base,
    title: 'Vitória!',
    nemesis: 'Jorge the Immortal',
    victim: 'Bob Sniper',
    victimKills: 6,
    mvp: 'Tryhard Bob',
    teamScore: true,
  };

  it('nenhum botão sai da área útil e todo texto de botão cabe nele (normal, Tryhard, Cenário, online, travado)', () => {
    for (const [name, w, h, minTextPx, minTarget] of TARGETS) {
      for (const [variant, d] of [
        ['normal', full],
        ['Tryhard', { ...full, openLab: true }],
        ['Cenário', { ...full, scenario: true }],
        ['online', { ...full, online: true }],
        ['travado', { ...full, locked: true, nemesisSaved: true }],
      ] as const) {
        const l = layoutTree(resultScreen.build(d), { x: 0, y: 0, w, h }, 1, { fonts, minTextPx, minTarget });
        const c = l.content;
        const tag = `${name} [${variant}]`;
        for (const node of l.order) {
          if (node.kind !== 'button') continue;
          const r = l.rects.get(node)!;
          expect(r.x >= c.x - 1 && r.x + r.w <= c.x + c.w + 1, `${tag}: ${node.id} (${r.x}, ${r.w})`).toBe(true);
          expect(r.y >= c.y - 1 && r.y + r.h <= c.y + c.h + 1, `${tag}: ${node.id} (${r.y}, ${r.h})`).toBe(true);
          const text = l.texts.get(node);
          const padX = node.compact ? BUTTON_COMPACT.padX : BUTTON.padX;
          if (text) expect(text.width, `${tag}: ${node.id}`).toBeLessThanOrEqual(r.w - 2 * padX * l.scale + 0.01);
        }
      }
    }
  });

  it('o online com Nêmesis também tem o "Salvar na Oficina"', () => {
    expect(find(resultScreen.build({ ...full, online: true }), 'saveWorkshop')).not.toBeNull();
  });
});
