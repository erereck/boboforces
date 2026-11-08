// Item 17 do Teste Zero: tela "aperte A" de teste com até 4 controles completos (tecnico.md §24.2). Mostra cada
// controle conectado (índice, tipo, `styleSet`, `deviceType`, vibração), dá o próximo slot de jogador a quem apertar
// A, vibra no X (`faceUp`: os botões são por posição) e registra o `+` (que tem que pausar, nunca fechar). Joy-Con
// avulso aparece e é recusado (#32). Tudo vai para o runtime.log em linhas `[t0] item=17`. O B volta (o game fecha a tela).
import type { TestItemContext, TestRunner } from '@boboforces/game';
import { PAD_BUTTON, type RawInputState } from '@boboforces/input';
import type { ControllerInfo } from '@boboforces/platform-api';
import type { TestScreenModel } from '@boboforces/ui';
import { controllerModel, createT0Logger, hex } from '../log.ts';
import { optionalKey } from '../strings.ts';
import { createButtonEdges, createLineBook } from './common.ts';

export const MAX_PLAYERS = 4;
const TITLE = optionalKey('test.controllers');
const HINT = optionalKey('test.controllers.hint');

export function startControllersTest(ctx: TestItemContext): TestRunner {
  const log = createT0Logger(ctx.log);
  const input = ctx.platform.input;
  const book = createLineBook();
  const edges = createButtonEdges();
  const infos: ControllerInfo[] = [];
  /** Slot de jogador → índice do controle (-1 vago). */
  const slots = new Int8Array(MAX_PLAYERS).fill(-1);
  /** O que estava conectado no frame anterior (índice, styleSet, deviceType), para logar só mudanças. */
  const prev = new Int32Array(8 * 3);
  let prevCount = -1;
  let count = 0;

  const slotOf = (index: number): number => slots.indexOf(index);

  const rebuild = (): void => {
    book.count = 0;
    const joined = MAX_PLAYERS - countFree();
    book.set(0, optionalKey('test.line.pressA'), `${joined} / ${MAX_PLAYERS}`, joined === MAX_PLAYERS ? 'ok' : 'wait');
    for (let i = 0; i < count; i++) {
      const c = infos[i]!;
      const slot = slotOf(c.index);
      const literal =
        `#${c.index + 1} ${c.kind} styleSet=${hex(c.styleSet)} deviceType=${hex(c.deviceType)}` +
        `${slot >= 0 ? ` P${slot + 1}` : ''}${c.canVibrate ? ' rumble' : ''}`;
      book.set(
        i + 1,
        optionalKey(c.complete ? 'test.line.controller' : 'test.line.joyConSingle'),
        literal,
        !c.complete ? 'fail' : slot >= 0 ? 'ok' : 'wait',
      );
    }
  };
  const countFree = (): number => {
    let n = 0;
    for (let i = 0; i < MAX_PLAYERS; i++) if (slots[i] === -1) n++;
    return n;
  };

  const describeNow = (): void => {
    if (!input.describeControllers) {
      count = 0;
      return;
    }
    count = input.describeControllers(infos);
    let same = count === prevCount;
    for (let i = 0; i < count && i < 8; i++) {
      const c = infos[i]!;
      if (prev[i * 3] !== c.index || prev[i * 3 + 1] !== c.styleSet || prev[i * 3 + 2] !== c.deviceType) same = false;
      prev[i * 3] = c.index;
      prev[i * 3 + 1] = c.styleSet;
      prev[i * 3 + 2] = c.deviceType;
    }
    prevCount = count;
    if (same) return;
    const order = infos
      .slice(0, count)
      .map((c) => `${c.index}`)
      .join('_');
    // Controle que sumiu perde o slot (a tela "aperte A" de verdade, M3, reserva; aqui é só teste).
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (slots[s]! >= 0 && !infos.slice(0, count).some((c) => c.index === slots[s])) slots[s] = -1;
    }
    log(17, 'info', { evento: 'mudanca', controles: count, indices: order || '-' });
    for (let i = 0; i < count; i++) {
      const c = infos[i]!;
      log(17, c.complete ? 'info' : 'falha', {
        evento: 'conectado',
        indice: c.index,
        modelo: controllerModel(c.id),
        tipo: c.kind,
        styleSet: hex(c.styleSet),
        deviceType: hex(c.deviceType),
        completo: c.complete,
        vibra: c.canVibrate,
      });
    }
    rebuild();
  };

  if (!input.describeControllers) {
    log(17, 'pulado', { motivo: 'describeControllers ausente' });
    book.set(0, null, 'describeControllers ausente', 'fail');
  } else {
    log(17, 'info', { evento: 'inicio' });
  }
  describeNow();

  return {
    finished: false,
    update(raw: Readonly<RawInputState>) {
      describeNow();
      edges.update(raw);
      for (let i = 0; i < count; i++) {
        const c = infos[i]!;
        if (edges.pressed(c.index, PAD_BUTTON.faceRight)) {
          if (!c.complete) {
            log(17, 'falha', { evento: 'recusado', indice: c.index, tipo: c.kind });
          } else if (slotOf(c.index) < 0) {
            const free = slots.indexOf(-1);
            if (free >= 0) {
              slots[free] = c.index;
              log(17, 'ok', { evento: 'entrou', jogador: free + 1, indice: c.index, tipo: c.kind });
              if (slots.indexOf(-1) < 0)
                log(17, 'ok', { evento: 'quatro_jogadores', slots: Array.from(slots).join('_') });
            }
          }
          rebuild();
        }
        // Botões por POSIÇÃO (`PAD_BUTTON`): o X do Switch é o de cima (`faceUp`); o da esquerda é o Y.
        if (edges.pressed(c.index, PAD_BUTTON.faceUp)) {
          input.vibrate(c.index, 0.8, 0.4, 300);
          log(17, c.canVibrate ? 'info' : 'falha', { evento: 'vibra', indice: c.index, vibra: c.canVibrate });
        }
        if (edges.pressed(c.index, PAD_BUTTON.start)) {
          log(17, 'ok', { evento: 'mais_bloqueado', indice: c.index });
          book.push(optionalKey('test.line.plusBlocked'), `#${c.index + 1}`, 'ok');
        }
      }
    },
    describe(out: TestScreenModel) {
      book.describe(out, TITLE, HINT);
    },
    dispose() {
      log(17, 'info', { evento: 'fim', jogadores: MAX_PLAYERS - countFree() });
    },
  };
}
