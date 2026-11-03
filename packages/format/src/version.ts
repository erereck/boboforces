// `version.json` (raiz) lido como constantes: versão do jogo, codinome e versões dos formatos.
// Quem muda versão é o fluxo de release; aqui só se lê.
import versionJson from '../../../version.json' with { type: 'json' };

export interface FormatVersions {
  /** settings@, stats@, backup@ e replay@ (o "save" do jogador). */
  readonly save: number;
  readonly preset: number;
  readonly bot: number;
  readonly map: number;
  /** Protocolo online (M5). */
  readonly protocol: number;
}

export const GAME_VERSION: string = versionJson.version;
export const GAME_CODENAME: string = versionJson.codename;
/** Data de lançamento (AAAA-MM-DD) ou `null` enquanto "Não lançado". */
export const GAME_RELEASED_AT: string | null = versionJson.releasedAt;
export const FORMAT_VERSIONS: FormatVersions = versionJson.formats;
