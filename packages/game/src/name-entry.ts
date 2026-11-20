import type { MatchRecipe } from '@boboforces/format';
import type { MenuInput, RawInputState } from '@boboforces/input';
import type { Platform, TextInputSession } from '@boboforces/platform-api';
import { t, type DrawList } from '@boboforces/ui';
import { customNameTeam, withTeamName } from './custom-match.ts';
import type { UiFrame } from './menu.ts';
import { cleanTypedName } from './names.ts';
import { createOnscreenKeyboard, type OnscreenKeyboard } from './onscreen-keyboard.ts';
import { TEAM_NAME_MAX } from './team-names.ts';

/**
 * M9 (fase 3): digitar um nome numa tela que não é dona do teclado (o nome do time do Sandbox na Partida
 * personalizada), do mesmo jeito do Laboratório e da Oficina (regra 14: só pelo `platform.textInput`): o teclado do
 * sistema (o swkbd no Switch; na web, o campo do navegador) ou, sem ele (ou ele não abriu) e com o controle na web, o
 * teclado do jogo, só no D-pad. Mora no pedaço dos editores: o menu da web só guarda a sessão e chama `frame`.
 */
export interface NameEntry {
  /**
   * 1x por frame: `'own'` = o teclado do jogo desenhou a tela inteira em `list`; `'system'` = o do sistema está aberto,
   * ou o aperto que fechou ainda está segurado (a tela de trás desenha, sem navegar); `'done'` = acabou.
   */
  frame(menu: MenuInput, raw: Readonly<RawInputState>, ui: UiFrame, list: DrawList): 'own' | 'system' | 'done';
  /** Fecha sem mexer no nome (a tela saiu). */
  close(): void;
  /** O teclado do sistema abriu (a tela de trás mostra o aviso de como gravar). */
  readonly system: boolean;
}

export interface NameEntryOptions {
  readonly platform: Platform;
  /** O último aperto veio do controle (na web, o teclado do jogo: não larga o controle para achar o do PC). */
  readonly gamepad: boolean;
  /** O título do teclado do jogo. */
  readonly title: string;
  readonly initial: string;
  readonly maxLength: number;
  /** O nome mudou (a tela de trás acompanha a digitação); no fim, o gravado, ou o de antes ao cancelar. */
  set(name: string): void;
  /** M9 (fase 3, revisão): gravar vazio vale (o time volta ao nome da cor); sem isto, vazio é o de antes. */
  readonly allowEmpty?: boolean;
  /** M9 (fase 3, revisão): o cancelar chama isto no lugar de `set(initial)` (a tela de trás volta inteira). */
  cancel?(): void;
}

function anyInputHeld(raw: Readonly<RawInputState>): boolean {
  if (raw.mouseButtons !== 0) return true;
  for (let k = 0; k < raw.keys.length; k++) if (raw.keys[k] === 1) return true;
  for (const pad of raw.gamepads) {
    if (!pad.connected) continue;
    for (let b = 0; b < pad.buttons.length; b++) if (pad.buttons[b]! >= 0.5) return true;
  }
  return false;
}

export function startNameEntry(o: NameEntryOptions): NameEntry {
  const clean = (text: string): string => cleanTypedName(text, o.maxLength);
  let session: TextInputSession | null = null;
  let keyboard: OnscreenKeyboard | null = null;
  /** O aperto que abriu (ou fechou) ainda está segurado: até soltar tudo, ninguém navega. */
  let hold = true;
  const finish = (name: string | null): void => {
    if (name === null) {
      if (o.cancel) o.cancel();
      else o.set(o.initial);
    } else o.set(name.trim() || (o.allowEmpty === true ? '' : o.initial));
    session?.close();
    session = null;
    keyboard = null;
    hold = true;
  };
  const own = !o.platform.textInput.available || (o.gamepad && o.platform.id !== 'switch');
  if (!own) {
    session = o.platform.textInput.open(
      { initial: o.initial, maxLength: o.maxLength, kind: 'name' },
      {
        onChange: (value) => o.set(clean(value)),
        onSubmit: (value) => finish(clean(value)),
        onCancel: () => finish(null),
      },
    );
  }
  if (session === null) {
    keyboard = createOnscreenKeyboard({
      title: o.title,
      initial: o.initial,
      maxLength: o.maxLength,
      clean,
      onChange: (value) => o.set(value),
    });
  }
  const system = session !== null;
  return {
    system,
    frame(menu, raw, ui, list) {
      if (hold && !anyInputHeld(raw)) hold = false;
      const kb = keyboard;
      if (kb !== null) {
        const r = hold ? (kb.draw(list, ui), 'open') : kb.frame(menu, raw, ui, list);
        if (r !== 'open') finish(r === 'submit' ? kb.value : null);
        return 'own';
      }
      return session !== null || hold ? 'system' : 'done';
    },
    close() {
      session?.close();
      session = null;
      keyboard = null;
      hold = false;
    },
  };
}

/**
 * M9 (fase 3): a Partida personalizada: o confirmar na linha do nome de um time do Sandbox (`teamName<i>`) abre o
 * teclado; `null` = outra linha (ou as setas: o nome não anda). O nome segue a digitação (`set`); vazio volta ao da cor.
 */
export function customNameEntry(
  rowId: string,
  delta: number,
  platform: Platform,
  gamepad: boolean,
  recipe: () => MatchRecipe,
  set: (recipe: MatchRecipe) => void,
): NameEntry | null {
  const team = delta === 0 ? customNameTeam(rowId) : -1;
  if (team < 0 || team >= recipe().teams.length) return null;
  const before = recipe();
  return startNameEntry({
    allowEmpty: true,
    cancel: () => set(before),
    platform,
    gamepad,
    title: t('custom.keyboardTitle'),
    initial: cleanTypedName(recipe().teams[team]?.name ?? '', TEAM_NAME_MAX),
    maxLength: TEAM_NAME_MAX,
    set: (name) => set(withTeamName(recipe(), team, name)),
  });
}
