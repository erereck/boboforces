// Peças comuns das telas de teste da casca (controles, teclado, áudio): borda de botão sem alocar e um livro de
// linhas que só muda em evento (o `describe` de todo frame só copia referências para o modelo da UI).
import { GAMEPAD_BUTTONS, MAX_GAMEPADS, type RawInputState } from '@boboforces/input';
import { TEST_SCREEN_MAX_LINES, type TestLineStatus, type TestScreenModel } from '@boboforces/ui';
import type { StringKey } from '@boboforces/ui';

/** Botão que DESCEU neste frame, por controle (o estado bruto só diz se está apertado). */
export interface ButtonEdges {
  update(raw: Readonly<RawInputState>): void;
  /** Desceu neste frame no controle `pad`. */
  pressed(pad: number, button: number): boolean;
  /** Desceu neste frame em qualquer controle; devolve o índice do controle ou -1. */
  anyPressed(button: number): number;
}

export function createButtonEdges(): ButtonEdges {
  const prev = new Uint8Array(MAX_GAMEPADS * GAMEPAD_BUTTONS);
  const edge = new Uint8Array(MAX_GAMEPADS * GAMEPAD_BUTTONS);
  let first = true;
  return {
    update(raw) {
      for (let p = 0; p < MAX_GAMEPADS; p++) {
        const pad = raw.gamepads[p];
        for (let b = 0; b < GAMEPAD_BUTTONS; b++) {
          const i = p * GAMEPAD_BUTTONS + b;
          const down = pad && pad.connected && (pad.buttons[b] ?? 0) > 0.5 ? 1 : 0;
          // No primeiro frame nada conta como borda: o botão que abriu a tela (A) ainda está apertado.
          edge[i] = !first && down && !prev[i] ? 1 : 0;
          prev[i] = down;
        }
      }
      first = false;
    },
    pressed: (pad, button) => edge[pad * GAMEPAD_BUTTONS + button] === 1,
    anyPressed(button) {
      for (let p = 0; p < MAX_GAMEPADS; p++) if (edge[p * GAMEPAD_BUTTONS + button] === 1) return p;
      return -1;
    },
  };
}

export interface BookLine {
  key: StringKey | null;
  literal: string;
  status: TestLineStatus;
}

/** Linhas da tela de teste, mudadas só em evento. */
export interface LineBook {
  readonly lines: readonly BookLine[];
  count: number;
  set(index: number, key: StringKey | null, literal: string, status: TestLineStatus): void;
  /** Acrescenta no fim (rola: acima do teto, a mais velha sai). */
  push(key: StringKey | null, literal: string, status: TestLineStatus): void;
  describe(out: TestScreenModel, titleKey: StringKey | null, hintKey: StringKey | null): void;
}

export function createLineBook(): LineBook {
  const lines: BookLine[] = [];
  for (let i = 0; i < TEST_SCREEN_MAX_LINES; i++) lines.push({ key: null, literal: '', status: 'info' });
  const book: LineBook = {
    lines,
    count: 0,
    set(index, key, literal, status) {
      const line = lines[index];
      if (!line) return;
      line.key = key;
      line.literal = literal;
      line.status = status;
      if (index >= book.count) book.count = index + 1;
    },
    push(key, literal, status) {
      if (book.count >= TEST_SCREEN_MAX_LINES) {
        const first = lines.shift()!;
        lines.push(first);
        book.count = TEST_SCREEN_MAX_LINES - 1;
      }
      book.set(book.count, key, literal, status);
    },
    describe(out, titleKey, hintKey) {
      out.titleKey = titleKey;
      out.hintKey = hintKey;
      const n = Math.min(book.count, out.lines.length);
      for (let i = 0; i < n; i++) {
        const src = lines[i]!;
        const dst = out.lines[i]!;
        dst.key = src.key;
        dst.literal = src.literal;
        dst.status = src.status;
      }
      out.lineCount = n;
    },
  };
  return book;
}
