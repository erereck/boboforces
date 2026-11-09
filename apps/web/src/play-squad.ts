// M2 (fases 3g e 3h): parâmetros de desenvolvimento do JOGAR antes dos menus da fase 4 (Partida personalizada):
// `?bots=fabrica` troca os bots do nível rápido pelos especiais contra o jogador e o Buddy no time dele (`PlaySquad` do
// game); `?nivel=suado` escolhe o nível do primeiro JOGAR. Sem as chaves, nada muda.
import type { GameDeps, PlaySquad } from '@boboforces/game';

/** O nível rápido (o tipo vem do contrato do jogo: o app web não depende do `format`). */
type BotLevel = NonNullable<GameDeps['playLevel']>;

/** Chave da URL (`?bots=fabrica`). */
export const PLAY_SQUAD_PARAM = 'bots';

/** O esquadrão que a URL pede, ou `null` (o padrão do jogo). */
export function playSquadFromUrl(search: string): PlaySquad | null {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const value = query.get(PLAY_SQUAD_PARAM)?.trim().toLowerCase();
  return value === 'fabrica' || value === 'fábrica' ? 'factory' : null;
}

/** Chave da URL do nível do primeiro JOGAR (`?nivel=suado`; M2, fase 3h). */
export const PLAY_LEVEL_PARAM = 'nivel';

/** Nomes da interface (sem acento, com hífen) e os ids dos 5 níveis rápidos. */
const LEVEL_NAMES: Readonly<Record<string, BotLevel>> = {
  'pela-vibe': 'vibe',
  vibe: 'vibe',
  'de-boa': 'chill',
  chill: 'chill',
  normal: 'normal',
  suado: 'sweaty',
  sweaty: 'sweaty',
  tryhard: 'tryhard',
};

/** O nível que a URL pede para o primeiro JOGAR, ou `null` (o padrão, Normal). */
export function playLevelFromUrl(search: string): BotLevel | null {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const value = query.get(PLAY_LEVEL_PARAM)?.trim().toLowerCase().replace(/\s+/g, '-');
  return value !== undefined && Object.prototype.hasOwnProperty.call(LEVEL_NAMES, value) ? LEVEL_NAMES[value]! : null;
}
