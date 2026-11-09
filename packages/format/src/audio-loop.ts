import { formatId, parseFormatId, type FormatId } from './format-id.ts';

/**
 * M2 (fase 7d): `loop@1`, o manifesto de uma música em loop (`music/<nome>.json`, ao lado do MP3), escrito pelo
 * `tools/audioconv --musica`. O MP3 tem o atraso do codificador no começo e o enchimento do último quadro no fim; o
 * manifesto diz onde o loop começa no áudio decodificado e quanto dura (medidos decodificando o próprio MP3 no Edge),
 * para o mixer recortar e tocar em loop sem buraco. Arquivo interno de build, como o `layers@1`.
 */
export const LOOP_FORMAT: FormatId = formatId('loop');

export interface LoopManifest {
  readonly format: FormatId;
  /** Onde o loop começa no áudio decodificado (s). */
  readonly loopStartS: number;
  /** Duração do loop (s): um número inteiro de compassos da música. */
  readonly loopS: number;
}

/** Teto de uma faixa em loop (tecnico.md §12: até ~90 s; folga para 2 min). */
export const LOOP_MAX_S = 120;

/** Lê e confere um `loop@1`; lança com mensagem clara se não servir (é arquivo de build, não do jogador). */
export function parseLoopManifest(json: unknown): LoopManifest {
  if (typeof json !== 'object' || json === null) throw new Error('loop: não é objeto');
  const o = json as Record<string, unknown>;
  const id = parseFormatId(o['format']);
  if (!id || id.kind !== 'loop') throw new Error(`loop: formato inválido (${String(o['format'])})`);
  if (id.version > 1) throw new Error(`loop: versão ${id.version} mais nova que a conhecida`);
  const start = o['loopStartS'];
  const len = o['loopS'];
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || start > 1)
    throw new Error(`loop: loopStartS inválido (${String(start)})`);
  if (typeof len !== 'number' || !Number.isFinite(len) || len < 1 || len > LOOP_MAX_S)
    throw new Error(`loop: loopS inválido (${String(len)})`);
  return { format: LOOP_FORMAT, loopStartS: start, loopS: len };
}
