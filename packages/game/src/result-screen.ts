import { COLORS, t, type Screen, type StringKey, type UiNode } from '@boboforces/ui';

/** M2 (fase 2e): ações da tela de resultado (gameplay.md §2.2). */
export const RESULT_ACTION = {
  again: 'again',
  easier: 'easier',
  harder: 'harder',
  changeRules: 'changeRules',
  savePreset: 'savePreset',
  saveWorkshop: 'saveWorkshop',
  /** M2 (fase 5e): no Tryhard, "Mais difícil" vira "Abrir Laboratório" (gameplay.md §6.6). */
  lab: 'lab',
  quit: 'quit',
} as const;

/** O que a tela mostra, já em texto (o `game` resolve os nomes e as contas de `summarizeMatch`). */
export interface ResultScreenData {
  /** Título: "Vitória!", "Derrota", "Empate" ou "Normal Bob venceu" (FFA). */
  readonly title: string;
  readonly titleColor: number;
  readonly own: number;
  readonly other: number;
  /** M3 (fase 2d): no lugar do placar ("Onda 7"); ausente = o placar `own × other`. */
  readonly scoreLine?: string;
  readonly mvp: string;
  /** `''` = ninguém. */
  readonly nemesis: string;
  readonly nemesisKills: number;
  readonly victim: string;
  readonly victimKills: number;
  readonly kills: number;
  /** "34%" ou "—". */
  readonly accuracy: string;
  readonly bestStreak: number;
  /** "Mira torta: Normal Bob". */
  readonly prizes: readonly string[];
  /** Nível rápido dos bots adversários agora ("Normal"). */
  readonly level: string;
  readonly canEasier: boolean;
  readonly canHarder: boolean;
  /** Derrota feia: o foco começa em "Mais fácil" (GDD §3.8). */
  readonly focusEasier: boolean;
  /** M2 (fase 4e): o preset desta partida já foi salvo (o botão vira "Preset salvo", desligado). */
  readonly presetSaved?: boolean;
  /** M2 (fase 5e): o Nêmesis já foi salvo na Oficina (o botão vira "Salvo na Oficina", desligado). */
  readonly nemesisSaved?: boolean;
  /** M2 (fase 5e): no Tryhard, "Mais difícil" vira "Abrir Laboratório". */
  readonly openLab?: boolean;
  /** M2 (fase 4g): o recorde que a partida bateu (o título dos números vira "Recorde!", em âmbar). */
  readonly record?: 'kills' | 'streak' | 'both';
}

const RECORD_TITLE = {
  kills: 'result.recordKills',
  streak: 'result.recordStreak',
  both: 'result.recordBoth',
} as const satisfies Record<NonNullable<ResultScreenData['record']>, StringKey>;

function line(id: string, key: StringKey, params: Record<string, string | number>, color: number = COLORS.texto) {
  return { kind: 'text', id, text: { key, params }, style: 'body', color, textAlign: 'center' } as UiNode;
}

function button(id: string, key: StringKey, action: string, extra: Partial<UiNode> = {}): UiNode {
  return { kind: 'button', id, text: { key }, action, variant: 'secondary', ...extra } as UiNode;
}

/**
 * Resultado, para ler em até 10 s: vencedor e placar, MVP, Nêmesis (com "Salvar na Oficina", desligado até a fase 5),
 * Freguês, os 3 números e até 3 prêmios bobos; embaixo, De novo · Mais fácil · Mais difícil e Mudar regras · Salvar
 * preset (desligados até a fase 4) · Sair. Tudo navegável no D-pad.
 */
export const resultScreen: Screen<ResultScreenData> = {
  id: 'result',
  build(d) {
    const nemesis: UiNode[] =
      d.nemesis !== ''
        ? [
            {
              kind: 'row',
              id: 'nemesisRow',
              align: 'center',
              gap: 12,
              children: [
                line('nemesis', 'result.nemesis', { name: d.nemesis, n: d.nemesisKills }),
                button(
                  'saveWorkshop',
                  d.nemesisSaved ? 'result.nemesisSaved' : 'result.saveWorkshop',
                  RESULT_ACTION.saveWorkshop,
                  { disabled: d.nemesisSaved === true },
                ),
              ],
            } as UiNode,
          ]
        : [line('nemesis', 'result.noNemesis', {}, COLORS.textoBaixo)];
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.veu,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'center',
          align: 'center',
          width: 760,
          gap: 10,
          children: [
            { kind: 'text', id: 'title', text: { literal: d.title }, style: 'title', color: d.titleColor },
            {
              kind: 'text',
              id: 'score',
              text:
                d.scoreLine !== undefined
                  ? { literal: d.scoreLine }
                  : { key: 'result.score', params: { own: d.own, other: d.other } },
              style: 'heading',
              color: COLORS.texto,
            },
            line('level', 'result.level', { level: d.level }, COLORS.textoBaixo),
            { kind: 'box', height: 6 },
            line('mvp', 'result.mvp', { name: d.mvp }),
            ...nemesis,
            d.victim !== ''
              ? line('victim', 'result.victim', { name: d.victim, n: d.victimKills })
              : line('victim', 'result.noVictim', {}, COLORS.textoBaixo),
            { kind: 'box', height: 6 },
            {
              kind: 'text',
              id: 'numbersTitle',
              text: { key: d.record ? RECORD_TITLE[d.record] : 'result.numbersTitle' },
              style: 'label',
              color: d.record ? COLORS.acao : COLORS.textoBaixo,
            },
            line('numbers', 'result.numbers', { kills: d.kills, accuracy: d.accuracy, streak: d.bestStreak }),
            ...(d.prizes.length > 0
              ? [
                  {
                    kind: 'text',
                    id: 'prizesTitle',
                    text: { key: 'result.prizesTitle' },
                    style: 'label',
                    color: COLORS.textoBaixo,
                  } as UiNode,
                  ...d.prizes.map(
                    (p, i) =>
                      ({
                        kind: 'text',
                        id: `prize${i}`,
                        text: { literal: p },
                        style: 'body',
                        color: COLORS.acao,
                      }) as UiNode,
                  ),
                ]
              : []),
            { kind: 'box', height: 10 },
            {
              kind: 'row',
              id: 'actions',
              gap: 12,
              children: [
                button('again', 'result.again', RESULT_ACTION.again, { variant: 'primary', autofocus: !d.focusEasier }),
                button('easier', 'result.easier', RESULT_ACTION.easier, {
                  disabled: !d.canEasier,
                  autofocus: d.focusEasier && d.canEasier,
                }),
                d.openLab
                  ? button('harder', 'result.openLab', RESULT_ACTION.lab)
                  : button('harder', 'result.harder', RESULT_ACTION.harder, { disabled: !d.canHarder }),
              ],
            },
            {
              kind: 'row',
              id: 'more',
              gap: 12,
              children: [
                button('changeRules', 'result.changeRules', RESULT_ACTION.changeRules),
                d.presetSaved
                  ? button('savePreset', 'result.presetSaved', RESULT_ACTION.savePreset, { disabled: true })
                  : button('savePreset', 'result.savePreset', RESULT_ACTION.savePreset),
                button('quit', 'result.quit', RESULT_ACTION.quit, { variant: 'danger' }),
              ],
            },
          ],
        },
      ],
    };
  },
};

/** M3 (fase 6a): uma linha da tabela do resultado do Bobo Zombies, já em texto. */
export interface ZombiesResultRow {
  readonly name: string;
  readonly color: number;
  readonly points: number;
  readonly kills: number;
  readonly headKills: number;
  readonly downs: number;
  readonly revives: number;
}

/** M3 (fase 6a): o que o resultado do Bobo Zombies mostra. */
export interface ZombiesResultData {
  /** "Sobreviveram às 10 ondas!" ou "Caíram na onda 7". */
  readonly title: string;
  readonly titleColor: number;
  /** "Base Abandonada · 10 ondas · 2 jogadores". */
  readonly config: string;
  /** "Recorde nesta configuração: onda 9", "Novo recorde! Antes: onda 6" ou "Primeira partida nesta configuração". */
  readonly record: string;
  /** O recorde caiu agora (a linha fica em âmbar). */
  readonly newRecord: boolean;
  readonly rows: readonly ZombiesResultRow[];
  readonly presetSaved?: boolean;
}

/** As colunas da tabela: largura (px de referência) e o título. */
const ZOMBIES_COLUMNS = [
  { id: 'name', width: 230, key: 'result.zombies.col.name' },
  { id: 'points', width: 100, key: 'result.zombies.col.points' },
  { id: 'kills', width: 90, key: 'result.zombies.col.kills' },
  { id: 'heads', width: 110, key: 'result.zombies.col.heads' },
  { id: 'downs', width: 80, key: 'result.zombies.col.downs' },
  { id: 'revives', width: 100, key: 'result.zombies.col.revives' },
] as const satisfies readonly { id: string; width: number; key: StringKey }[];

function cell(id: string, width: number, text: string, color: number, left: boolean): UiNode {
  return {
    kind: 'text',
    id,
    width,
    text: { literal: text },
    style: 'body',
    color,
    textAlign: left ? 'left' : 'center',
  } as UiNode;
}

/**
 * M3 (fase 6a): o resultado do Bobo Zombies (gameplay.md "Bobo Zombies": recorde de onda por mapa e configuração): a
 * onda, a configuração, o recorde e uma linha por bobo do time (pontos, abates, na cabeça, caídas, quantos levantou);
 * embaixo, De novo · Mudar regras · Salvar preset · Sair. Sem Nêmesis, prêmios nem nível (não há bot adversário).
 */
export const zombiesResultScreen: Screen<ZombiesResultData> = {
  id: 'result-zombies',
  build(d) {
    const header: UiNode = {
      kind: 'row',
      id: 'tableHead',
      gap: 4,
      children: ZOMBIES_COLUMNS.map((c, i) => cell(`h-${c.id}`, c.width, t(c.key), COLORS.textoBaixo, i === 0)),
    } as UiNode;
    const rows: UiNode[] = d.rows.map(
      (r, k) =>
        ({
          kind: 'row',
          id: `row${k}`,
          gap: 4,
          children: [
            cell(`r${k}-name`, ZOMBIES_COLUMNS[0].width, r.name, r.color, true),
            cell(`r${k}-points`, ZOMBIES_COLUMNS[1].width, String(r.points), COLORS.acao, false),
            cell(`r${k}-kills`, ZOMBIES_COLUMNS[2].width, String(r.kills), COLORS.texto, false),
            cell(`r${k}-heads`, ZOMBIES_COLUMNS[3].width, String(r.headKills), COLORS.texto, false),
            cell(`r${k}-downs`, ZOMBIES_COLUMNS[4].width, String(r.downs), COLORS.texto, false),
            cell(`r${k}-revives`, ZOMBIES_COLUMNS[5].width, String(r.revives), COLORS.texto, false),
          ],
        }) as UiNode,
    );
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.veu,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'center',
          align: 'center',
          width: 760,
          gap: 10,
          children: [
            { kind: 'text', id: 'title', text: { literal: d.title }, style: 'title', color: d.titleColor },
            {
              kind: 'text',
              id: 'config',
              text: { literal: d.config },
              style: 'body',
              color: COLORS.textoBaixo,
              textAlign: 'center',
            },
            {
              kind: 'text',
              id: 'record',
              text: { literal: d.record },
              style: 'heading',
              color: d.newRecord ? COLORS.acao : COLORS.texto,
              textAlign: 'center',
            },
            { kind: 'box', height: 6 },
            header,
            ...rows,
            { kind: 'box', height: 10 },
            {
              kind: 'row',
              id: 'actions',
              gap: 12,
              children: [
                button('again', 'result.again', RESULT_ACTION.again, { variant: 'primary', autofocus: true }),
                button('changeRules', 'result.changeRules', RESULT_ACTION.changeRules),
                d.presetSaved
                  ? button('savePreset', 'result.presetSaved', RESULT_ACTION.savePreset, { disabled: true })
                  : button('savePreset', 'result.savePreset', RESULT_ACTION.savePreset),
                button('quit', 'result.quit', RESULT_ACTION.quit, { variant: 'danger' }),
              ],
            },
          ],
        },
      ],
    };
  },
};

/** "Mira torta: Normal Bob" (montado uma vez, no fim da partida). */
export function prizeLine(prize: string, name: string): string {
  return t('result.prizeLine', { prize: t(`prize.${prize}` as StringKey), name });
}
