import type { MenuInput, RawInputState } from '@boboforces/input';
import { COLORS, t, type DrawList, type UiNode } from '@boboforces/ui';
import { createMenuController, type UiFrame } from './menu.ts';

/**
 * M4 (fase 4d): o teclado do jogo, no canvas. Serve quando não há teclado do sistema (`platform.textInput.available`
 * falso, ou o swkbd do Switch que não abriu) e quando se digita com o controle na web (sem largar o controle para
 * achar o teclado do PC). Só D-pad + confirmar/voltar (regra "todo fluxo só com D-pad"), alvos grandes, e só os
 * caracteres que o nome do bot aceita (`cleanBotName`) e que a fonte do jogo tem.
 *
 * Atalhos: L apaga, R alterna maiúsculas, B cancela (o nome volta a ser o de antes). OK grava.
 */
export const KEYBOARD_PAGES = {
  letters: ['1234567890', 'qwertyuiop', 'asdfghjklç', 'zxcvbnm,.-'],
  accents: ['áàâãéêíóôõ', "úüñ!?&'.,-"],
} as const;

export type KeyboardPage = keyof typeof KEYBOARD_PAGES;

/** Ações dos botões (`key:<caractere>` digita). */
export const KEYBOARD_ACTION = {
  keyPrefix: 'key:',
  shift: 'shift',
  page: 'page',
  space: 'space',
  erase: 'erase',
  ok: 'ok',
} as const;

export interface KeyboardState {
  readonly title: string;
  readonly value: string;
  readonly maxLength: number;
  readonly page: KeyboardPage;
  readonly upper: boolean;
}

/** Largura de uma tecla e o espaço entre elas (px de referência, 1280×720). */
const KEY_W = 60;
const KEY_GAP = 8;

function key(id: string, label: string, action: string, extra: Partial<UiNode> = {}): UiNode {
  return {
    kind: 'button',
    id,
    text: { literal: label },
    action,
    variant: 'secondary',
    compact: true,
    width: KEY_W,
    ...extra,
  } as UiNode;
}

function keyLabel(ch: string, upper: boolean): string {
  return upper ? ch.toUpperCase() : ch;
}

/** A árvore do teclado: o nome com o cursor, as linhas de teclas e a linha de controle. */
export function keyboardTree(state: KeyboardState): UiNode {
  const rows = KEYBOARD_PAGES[state.page].map((line, r): UiNode => ({
    kind: 'row',
    id: `row-${r}`,
    gap: KEY_GAP,
    children: Array.from(line, (ch, c) =>
      key(`k-${r}-${c}`, keyLabel(ch, state.upper), KEYBOARD_ACTION.keyPrefix + ch, {
        autofocus: r === 1 && c === 0,
      }),
    ),
  }));
  const rowW = 10 * KEY_W + 9 * KEY_GAP;
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
        width: rowW,
        gap: 10,
        children: [
          { kind: 'text', id: 'title', text: { literal: state.title }, style: 'heading', color: COLORS.texto },
          {
            kind: 'text',
            id: 'value',
            // A fonte de leitura (a dos títulos só tem maiúsculas): o nome aparece como vai ficar.
            text: { literal: `${state.value}_` },
            style: 'number',
            color: COLORS.acao,
            textAlign: 'center',
          },
          {
            kind: 'text',
            id: 'count',
            text: {
              key: state.upper ? 'keyboard.countUpper' : 'keyboard.count',
              params: { n: [...state.value].length, max: state.maxLength },
            },
            style: 'caption',
            color: COLORS.textoBaixo,
          },
          { kind: 'box', height: 4 },
          ...rows,
          // A linha de controle em duas (a 640×360, o piso do texto não deixa 5 botões numa linha só).
          {
            kind: 'row',
            id: 'controls',
            gap: KEY_GAP,
            children: [
              key('shift', t(state.upper ? 'keyboard.lower' : 'keyboard.upper'), KEYBOARD_ACTION.shift, { width: 200 }),
              key('page', t(state.page === 'letters' ? 'keyboard.accents' : 'keyboard.letters'), KEYBOARD_ACTION.page, {
                width: 200,
              }),
              key('erase', t('keyboard.erase'), KEYBOARD_ACTION.erase, { width: rowW - 400 - 2 * KEY_GAP }),
            ],
          },
          {
            kind: 'row',
            id: 'controls-2',
            gap: KEY_GAP,
            children: [
              key('space', t('keyboard.space'), KEYBOARD_ACTION.space, { width: 400 }),
              key('ok', t('keyboard.ok'), KEYBOARD_ACTION.ok, { width: rowW - 400 - KEY_GAP, variant: 'primary' }),
            ],
          },
          { kind: 'box', height: 2 },
          {
            kind: 'text',
            id: 'help',
            text: { key: 'keyboard.help' },
            style: 'caption',
            color: COLORS.texto,
            textAlign: 'center',
          },
        ],
      },
    ],
  };
}

/** O resultado de um frame do teclado: segue aberto, gravou (`value`) ou cancelou. */
export type KeyboardResult = 'open' | 'submit' | 'cancel';

export interface OnscreenKeyboard {
  readonly value: string;
  /** 1x por frame: anda o foco, digita e desenha em `list`. */
  frame(menu: MenuInput, raw: Readonly<RawInputState>, ui: UiFrame, list: DrawList): KeyboardResult;
  /** Só desenha (o frame em que o aperto que abriu ainda está segurado). */
  draw(list: DrawList, ui: UiFrame): void;
}

export interface OnscreenKeyboardOptions {
  readonly title: string;
  readonly initial: string;
  readonly maxLength: number;
  /** O filtro do campo (o mesmo da digitação pelo sistema, ex. `cleanBotName`). */
  readonly clean: (text: string) => string;
  /** O valor mudou (a tela de trás acompanha, como no teclado do sistema). */
  readonly onChange?: (value: string) => void;
}

/** Um passo do estado (puro): a ação de um botão ou de um atalho. */
export function keyboardStep(
  state: KeyboardState,
  action: string,
  clean: (text: string) => string,
): KeyboardState | 'submit' {
  if (action === KEYBOARD_ACTION.ok) return 'submit';
  if (action === KEYBOARD_ACTION.shift) return { ...state, upper: !state.upper };
  if (action === KEYBOARD_ACTION.page) return { ...state, page: state.page === 'letters' ? 'accents' : 'letters' };
  if (action === KEYBOARD_ACTION.erase) {
    const chars = [...state.value];
    chars.pop();
    // Apagou tudo: a próxima letra sai maiúscula (o começo do nome).
    return { ...state, value: chars.join(''), upper: state.upper || chars.length === 0 };
  }
  let add = '';
  if (action === KEYBOARD_ACTION.space) add = ' ';
  else if (action.startsWith(KEYBOARD_ACTION.keyPrefix))
    add = keyLabel(action.slice(KEYBOARD_ACTION.keyPrefix.length), state.upper);
  if (add === '' || [...state.value].length >= state.maxLength) return state;
  const value = clean(state.value + add);
  // A maiúscula vale para uma letra (como no celular); o R deixa ligada de novo.
  return { ...state, value, upper: state.upper && value === state.value };
}

export function createOnscreenKeyboard(opts: OnscreenKeyboardOptions): OnscreenKeyboard {
  const menu = createMenuController();
  let state: KeyboardState = {
    title: opts.title,
    value: opts.clean(opts.initial),
    maxLength: opts.maxLength,
    page: 'letters',
    // O nome vazio começa em maiúscula.
    upper: opts.initial === '',
  };
  menu.setRoot(keyboardTree(state));
  const apply = (action: string): KeyboardResult => {
    const next = keyboardStep(state, action, opts.clean);
    if (next === 'submit') return 'submit';
    if (next === state) return 'open';
    const changed = next.value !== state.value;
    state = next;
    menu.setRoot(keyboardTree(state));
    if (changed) opts.onChange?.(state.value);
    return 'open';
  };
  return {
    get value(): string {
      return state.value;
    },
    frame(input, raw, ui, list): KeyboardResult {
      const nav = menu.update(input, raw, ui);
      let result: KeyboardResult = 'open';
      if (nav.back) result = 'cancel';
      else if (nav.tab < 0) result = apply(KEYBOARD_ACTION.erase);
      else if (nav.tab > 0) result = apply(KEYBOARD_ACTION.shift);
      else if (nav.activated !== null) result = apply(nav.activated);
      if (result === 'open') menu.draw(list, ui);
      return result;
    },
    draw(list, ui): void {
      menu.draw(list, ui);
    },
  };
}
