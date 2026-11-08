// Tabela dos sons a converter (`assets-src/audio/sounds.json`): de onde vem cada som (pacote CC0 + arquivo) e como
// tratar (corte e pico). Validação estrita: a ferramenta para com mensagem clara em vez de gerar um MP3 errado.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIO_SOURCE_DIR } from './paths.ts';

export interface SoundPack {
  readonly title: string;
  readonly author: string;
  readonly url: string;
  readonly license: string;
  readonly zipSha256: string;
  readonly downloaded: string;
}

export interface SoundEntry {
  /** Nome de saída sem extensão (`t0-tiro` → `generated/t0-tiro.mp3`). */
  readonly out: string;
  readonly pack: string;
  readonly file: string;
  /** Duração máxima (s); o fim é cortado com fade. */
  readonly maxS: number;
  /** Pico normalizado (dBFS, ≤ 0). */
  readonly peakDb: number;
}

export interface SoundTable {
  readonly packs: Readonly<Record<string, SoundPack>>;
  readonly sounds: readonly SoundEntry[];
}

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || v === '') throw new Error(`sounds.json: ${what} precisa ser texto`);
  return v;
};
const num = (v: unknown, what: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw new Error(`sounds.json: ${what} fora de ${min}..${max}`);
  return v;
};

/** Lê e valida a tabela. `sourceDir` padrão = `assets-src/audio/source`. Confere que arquivo e licença existem. */
export function parseSoundTable(text: string, sourceDir: string = AUDIO_SOURCE_DIR): SoundTable {
  const raw = JSON.parse(text) as { packs?: unknown; sounds?: unknown };
  if (!raw.packs || typeof raw.packs !== 'object') throw new Error('sounds.json: sem "packs"');
  if (!Array.isArray(raw.sounds)) throw new Error('sounds.json: sem "sounds"');
  const packs: Record<string, SoundPack> = {};
  for (const [id, p] of Object.entries(raw.packs as Record<string, Record<string, unknown>>)) {
    packs[id] = {
      title: str(p['title'], `${id}.title`),
      author: str(p['author'], `${id}.author`),
      url: str(p['url'], `${id}.url`),
      license: str(p['license'], `${id}.license`),
      zipSha256: str(p['zipSha256'], `${id}.zipSha256`),
      downloaded: str(p['downloaded'], `${id}.downloaded`),
    };
    if (!/CC0/.test(packs[id].license)) throw new Error(`sounds.json: ${id} não é CC0 (decisão #39)`);
    if (!existsSync(join(sourceDir, id, 'License.txt')))
      throw new Error(`sounds.json: falta source/${id}/License.txt (a licença vai junto do original)`);
  }
  const seen = new Set<string>();
  const sounds = (raw.sounds as Record<string, unknown>[]).map((s, i) => {
    const entry: SoundEntry = {
      out: str(s['out'], `sounds[${i}].out`),
      pack: str(s['pack'], `sounds[${i}].pack`),
      file: str(s['file'], `sounds[${i}].file`),
      maxS: num(s['maxS'], `sounds[${i}].maxS`, 0.02, 30),
      peakDb: num(s['peakDb'], `sounds[${i}].peakDb`, -40, 0),
    };
    if (!/^[a-z0-9-]+$/.test(entry.out)) throw new Error(`sounds.json: nome de saída inválido "${entry.out}"`);
    if (seen.has(entry.out)) throw new Error(`sounds.json: saída repetida "${entry.out}"`);
    seen.add(entry.out);
    if (!packs[entry.pack]) throw new Error(`sounds.json: pacote desconhecido "${entry.pack}"`);
    if (!existsSync(join(sourceDir, entry.pack, entry.file)))
      throw new Error(`sounds.json: falta source/${entry.pack}/${entry.file}`);
    return entry;
  });
  return { packs, sounds };
}

export function readSoundTable(path: string, sourceDir?: string): SoundTable {
  return parseSoundTable(readFileSync(path, 'utf8'), sourceDir);
}
