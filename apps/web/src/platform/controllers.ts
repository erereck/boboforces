import type { ControllerInfo, RawInputSource } from '@boboforces/platform-api';
import { MAX_GAMEPADS } from '@boboforces/input';
import type { Disposable } from '@boboforces/shared';

/** O pedaço da Gamepad API que a descrição lê (injetável nos testes). */
export interface GamepadLike {
  readonly connected: boolean;
  readonly id: string;
  readonly mapping: string;
  readonly vibrationActuator?: unknown;
}

export type GetGamepads = () => readonly (GamepadLike | null)[] | null;

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * `RawInputSource.describeControllers` da web (contrato do M1; tela "aperte A" e glifos). Mesmos índices do
 * `RawInputState.gamepads` que os adaptadores de `src/input` preenchem (`getGamepads()[i]`, até `MAX_GAMEPADS`). Na web
 * não existe Joy-Con avulso nem `styleSet`: todo controle conta como completo e o tipo é `standard` só com o
 * mapeamento padrão (sem detectar marca, como o adaptador). Reaproveita as entradas de `out` (sem alocar no frame) e
 * devolve quantos controles escreveu no começo do array.
 */
export function describeWebControllers(getGamepads: GetGamepads, out: ControllerInfo[]): number {
  let list: readonly (GamepadLike | null)[] | null = null;
  try {
    list = getGamepads();
  } catch {
    // Política de permissões bloqueando a Gamepad API: nenhum controle.
    list = null;
  }
  let n = 0;
  for (let i = 0; i < MAX_GAMEPADS; i++) {
    const gp = list ? list[i] : null;
    if (!gp || !gp.connected) continue;
    const entry = (out[n] ?? {}) as Writable<ControllerInfo>;
    entry.index = i;
    entry.id = gp.id;
    entry.kind = gp.mapping === 'standard' ? 'standard' : 'unknown';
    entry.styleSet = -1;
    entry.deviceType = -1;
    entry.complete = true;
    entry.canVibrate = gp.vibrationActuator !== undefined && gp.vibrationActuator !== null;
    out[n++] = entry;
  }
  return n;
}

/**
 * Fonte de input com `describeControllers`: a própria, se já tiver; senão uma nova que repassa `poll`, `vibrate` e
 * `dispose` (os adaptadores de `src/input` não mudam no M1). O `poll` repassado é um `bind`: nada novo por frame.
 */
export function withControllerInfo(
  source: RawInputSource & Partial<Disposable>,
  getGamepads: GetGamepads,
): RawInputSource & Partial<Disposable> {
  if (source.describeControllers) return source;
  const wrapped: RawInputSource & Partial<Disposable> = {
    poll: source.poll.bind(source),
    vibrate: source.vibrate.bind(source),
    describeControllers: (out: ControllerInfo[]) => describeWebControllers(getGamepads, out),
  };
  if (source.dispose) wrapped.dispose = source.dispose.bind(source);
  return wrapped;
}
