import type { TextInput, TextInputKind } from '@boboforces/platform-api';
import type { NxVirtualKeyboard } from './nx.ts';

/**
 * Entrada de texto pelo teclado do sistema do Switch (regra 14; item 18 do Teste Zero): `navigator.virtualKeyboard` do
 * nx.js, o swkbd "inline" desenhado por cima do jogo. Eventos do nx.js 1.0.0-beta.7: `change` e `cursormove` (texto e
 * cursor), `submit` (OK) e `geometrychange` (mostrou ou escondeu). Cancelar (B no teclado) só esconde, sem evento
 * próprio: um `geometrychange` com altura 0 sem `submit` antes vira `onCancel`. Sem `virtualKeyboard`, `open` devolve
 * `null` e o jogo usa o teclado próprio no canvas.
 */

/** `type` do swkbd (SwkbdType do libnx): normal ou só números. */
const KEYBOARD_TYPE = { normal: 0, numPad: 1 } as const;

function keyboardType(kind: TextInputKind): number {
  void kind; // nome, código e texto livre usam o teclado completo (códigos têm letras)
  return KEYBOARD_TYPE.normal;
}

export interface SwitchTextInputOptions {
  readonly keyboard: NxVirtualKeyboard | undefined;
  readonly onEvent?: (description: string) => void;
}

export function createSwitchTextInput(opts: SwitchTextInputOptions): TextInput {
  const kb = opts.keyboard;
  let active: (() => void) | null = null;
  return {
    get available() {
      return !!kb;
    },
    open(request, listener) {
      if (!kb) return null;
      active?.();
      let submitted = false;
      let shown = false;
      let closed = false;
      const onChange = (): void => listener.onChange(kb.value, kb.cursorIndex);
      const onSubmit = (): void => {
        submitted = true;
        listener.onSubmit(kb.value);
      };
      const onGeometry = (): void => {
        const visible = kb.boundingRect.height > 0;
        if (visible) {
          shown = true;
          return;
        }
        if (!shown || closed) return;
        // No OK, o nx.js esconde (este evento) ANTES de disparar o `submit`, na mesma chamada: decide numa microtarefa.
        void Promise.resolve().then(() => {
          if (!submitted && !closed) listener.onCancel();
          detach();
        });
      };
      const detach = (): void => {
        if (closed) return;
        closed = true;
        kb.removeEventListener('change', onChange);
        kb.removeEventListener('cursormove', onChange);
        kb.removeEventListener('submit', onSubmit);
        kb.removeEventListener('geometrychange', onGeometry);
        if (active === close) active = null;
      };
      const close = (): void => {
        if (closed) return;
        detach();
        try {
          kb.hide();
        } catch {
          // já escondido
        }
      };
      kb.addEventListener('change', onChange);
      kb.addEventListener('cursormove', onChange);
      kb.addEventListener('submit', onSubmit);
      kb.addEventListener('geometrychange', onGeometry);
      try {
        kb.type = keyboardType(request.kind);
        kb.maxLength = request.maxLength;
        kb.enableReturn = false;
        kb.value = request.initial;
        kb.cursorIndex = request.initial.length;
        kb.show();
      } catch (error) {
        opts.onEvent?.(
          `teclado do sistema falhou ao abrir: ${String((error as { message?: unknown })?.message ?? error)}`,
        );
        detach();
        return null;
      }
      active = close;
      return { close };
    },
  };
}
