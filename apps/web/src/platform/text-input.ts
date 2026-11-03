import type { TextInput, TextInputKind, TextInputListener, TextInputSession } from '@boboforces/platform-api';
import type { Disposable } from '@boboforces/shared';

interface KindConfig {
  readonly autocapitalize: string;
  readonly spellcheck: boolean;
}

const KIND_CONFIG: Readonly<Record<TextInputKind, KindConfig>> = {
  name: { autocapitalize: 'words', spellcheck: false },
  code: { autocapitalize: 'characters', spellcheck: false },
  text: { autocapitalize: 'sentences', spellcheck: true },
};

interface ActiveSession {
  readonly listener: TextInputListener;
  caret: number;
  closed: boolean;
}

/**
 * Entrada de texto da web (decisão #3, tecnico.md §9): um `<input>` escondido que abre o teclado nativo no celular e
 * recebe a digitação no PC. O jogo desenha o campo no canvas com o valor e o cursor que chegam em `onChange`.
 *
 * - Enter confirma (`onSubmit`), Esc cancela (`onCancel`); `close()` encerra sem callback. Uma sessão por vez.
 * - Quem manda na duração da sessão é o jogo. Perder o foco (clique no canvas, teclado do celular fechado) não
 *   encerra: o próximo toque ou clique devolve o foco ao input, e é esse gesto que deixa o iOS abrir o teclado
 *   (ele recusa `focus()` fora de um gesto, e o jogo abre a sessão de dentro do laço de frames).
 * - As teclas param aqui (`stopPropagation`): o adaptador de teclado não vê "W" virar andar enquanto o jogador digita.
 */
export function createWebTextInput(doc: Document): TextInput & Disposable {
  let input: HTMLInputElement | null = null;
  let active: ActiveSession | null = null;

  function ensureInput(): HTMLInputElement {
    if (input) return input;
    const el = doc.createElement('input');
    el.type = 'text';
    el.autocomplete = 'off';
    el.setAttribute('autocorrect', 'off');
    el.enterKeyHint = 'done';
    el.inputMode = 'text';
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    // 16 px evita o zoom automático do iOS ao focar; transparente porque o campo de verdade é desenhado pelo jogo.
    el.style.cssText =
      'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;border:0;padding:0;font-size:16px;' +
      'caret-color:transparent;background:transparent;color:transparent;pointer-events:none';
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('keyup', onKeyUp);
    doc.body.appendChild(el);
    input = el;
    return el;
  }

  function caretOf(el: HTMLInputElement): number {
    return el.selectionEnd ?? el.value.length;
  }

  function onInput(this: HTMLInputElement): void {
    if (!active || active.closed) return;
    active.caret = caretOf(this);
    active.listener.onChange(this.value, active.caret);
  }

  function onKeyDown(this: HTMLInputElement, event: KeyboardEvent): void {
    event.stopPropagation();
    if (!active || active.closed || event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      end('submit');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      end('cancel');
    }
  }

  function onKeyUp(this: HTMLInputElement, event: KeyboardEvent): void {
    event.stopPropagation();
    // Setas, Home e End movem o cursor sem disparar `input`.
    if (!active || active.closed) return;
    const caret = caretOf(this);
    if (caret !== active.caret) {
      active.caret = caret;
      active.listener.onChange(this.value, caret);
    }
  }

  function refocus(): void {
    if (active && !active.closed && input && doc.activeElement !== input) input.focus({ preventScroll: true });
  }

  function end(how: 'submit' | 'cancel' | 'close'): void {
    const session = active;
    if (!session || session.closed) return;
    session.closed = true;
    active = null;
    doc.removeEventListener('pointerup', refocus, true);
    doc.removeEventListener('touchend', refocus, true);
    const value = input?.value ?? '';
    if (input) {
      input.blur();
      input.value = '';
    }
    if (how === 'submit') session.listener.onSubmit(value);
    else if (how === 'cancel') session.listener.onCancel();
  }

  return {
    available: true,
    open(request, listener): TextInputSession {
      end('close');
      const el = ensureInput();
      const config = KIND_CONFIG[request.kind];
      el.setAttribute('autocapitalize', config.autocapitalize);
      el.spellcheck = config.spellcheck;
      el.maxLength = request.maxLength;
      el.value = request.initial.slice(0, request.maxLength);
      const session: ActiveSession = { listener, caret: el.value.length, closed: false };
      active = session;
      doc.addEventListener('pointerup', refocus, true);
      doc.addEventListener('touchend', refocus, true);
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
      return {
        close() {
          if (active === session) end('close');
        },
      };
    },
    dispose() {
      end('close');
      if (input) {
        input.removeEventListener('input', onInput);
        input.removeEventListener('keydown', onKeyDown);
        input.removeEventListener('keyup', onKeyUp);
        input.remove();
        input = null;
      }
    },
  };
}
