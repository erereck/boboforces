import { COLORS, t, type Screen, type StringKey, type UiNode } from '@boboforces/ui';

/** M2 (fase 2e): ações da tela de resultado (gameplay.md §2.2). */
export const RESULT_ACTION = {
  again: 'again',
  easier: 'easier',
  harder: 'harder',
  changeRules: 'changeRules',
  savePreset: 'savePreset',
  saveWorkshop: 'saveWorkshop',
  quit: 'quit',
} as const;

/** O que a tela mostra, já em texto (o `game` resolve os nomes e as contas de `summarizeMatch`). */
export interface ResultScreenData {
  /** Título: "Vitória!", "Derrota", "Empate" ou "Normal Bob venceu" (FFA). */
  readonly title: string;
  readonly titleColor: number;
  readonly own: number;
  readonly other: number;
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
}

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
                button('saveWorkshop', 'result.saveWorkshop', RESULT_ACTION.saveWorkshop, { disabled: true }),
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
              text: { key: 'result.score', params: { own: d.own, other: d.other } },
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
              text: { key: 'result.numbersTitle' },
              style: 'label',
              color: COLORS.textoBaixo,
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
                button('harder', 'result.harder', RESULT_ACTION.harder, { disabled: !d.canHarder }),
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

/** "Mira torta: Normal Bob" (montado uma vez, no fim da partida). */
export function prizeLine(prize: string, name: string): string {
  return t('result.prizeLine', { prize: t(`prize.${prize}` as StringKey), name });
}
