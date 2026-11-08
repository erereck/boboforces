// Item 18 do Teste Zero: teclado do sistema pelo `platform.textInput` (no Switch, o swkbd inline do nx.js). Abre na
// entrada da tela e no A; mostra o que foi digitado (dado do jogador, só na tela) e grava no runtime.log só os
// eventos e o TAMANHO do texto, nunca o conteúdo.
import type { TestItemContext, TestRunner } from '@boboforces/game';
import { PAD_BUTTON, type RawInputState } from '@boboforces/input';
import type { TextInputSession } from '@boboforces/platform-api';
import type { TestScreenModel } from '@boboforces/ui';
import { createT0Logger, ms2 } from '../log.ts';
import { optionalKey } from '../strings.ts';
import { createButtonEdges, createLineBook } from './common.ts';

const TITLE = optionalKey('test.keyboard');
const HINT = optionalKey('test.keyboard.hint');
/** Mesmo teto dos nomes do online (DECISOES: até 16 caracteres). */
export const KEYBOARD_TEST_MAX_LENGTH = 16;

export function startKeyboardTest(ctx: TestItemContext): TestRunner {
  const log = createT0Logger(ctx.log);
  const { textInput } = ctx.platform;
  const now = (): number => ctx.platform.now();
  const book = createLineBook();
  const edges = createButtonEdges();
  let session: TextInputSession | null = null;
  let opens = 0;
  let changes = 0;
  let openedAt = 0;

  const open = (): void => {
    if (session) return;
    if (!textInput.available) {
      log(18, 'falha', { disponivel: false });
      book.set(0, optionalKey('test.line.keyboardUnavailable'), '', 'fail');
      return;
    }
    changes = 0;
    openedAt = now();
    session = textInput.open(
      { initial: '', maxLength: KEYBOARD_TEST_MAX_LENGTH, kind: 'name' },
      {
        onChange(value) {
          changes++;
          book.set(1, optionalKey('test.line.typed'), value, 'info');
        },
        onSubmit(value) {
          session = null;
          log(18, 'ok', { evento: 'confirmou', tamanho: value.length, mudancas: changes, ms: ms2(now() - openedAt) });
          book.set(1, optionalKey('test.line.typed'), value, 'ok');
          book.set(2, optionalKey('test.line.submitted'), `${value.length}`, 'ok');
        },
        onCancel() {
          session = null;
          log(18, 'info', { evento: 'cancelou', mudancas: changes });
          book.set(2, optionalKey('test.line.cancelled'), '', 'info');
        },
      },
    );
    opens++;
    if (!session) {
      log(18, 'falha', { disponivel: true, evento: 'nao_abriu' });
      book.set(0, optionalKey('test.line.keyboardUnavailable'), '', 'fail');
      return;
    }
    log(18, 'info', { evento: 'abriu', vez: opens, ms: ms2(now() - openedAt) });
    book.set(0, optionalKey('test.line.keyboardOpen'), `${opens}`, 'wait');
  };

  open();

  return {
    finished: false,
    update(raw: Readonly<RawInputState>) {
      edges.update(raw);
      if (!session && edges.anyPressed(PAD_BUTTON.faceRight) >= 0) open();
    },
    describe(out: TestScreenModel) {
      book.describe(out, TITLE, HINT);
    },
    dispose() {
      session?.close();
      session = null;
    },
  };
}
