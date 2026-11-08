import { join, resolve } from 'node:path';

/**
 * Caminhos do audioconv (contrato do M1): os originais CC0 baixados da Kenney ficam em `assets-src/audio/source/<pacote>/`
 * (com o `License.txt` do pacote ao lado, decisão #47), a tabela de conversão em `assets-src/audio/sounds.json` e os
 * MP3 gerados em `assets-src/audio/generated/`, com os nomes lógicos cadastrados no `runtime-assets.json`
 * (`t0-tiro.mp3`, `t0-impacto.mp3`, `t0-passo.mp3`, `t0-ui.mp3`). Crédito de cada arquivo em `docs/CREDITOS.md` §4.
 */
export const ROOT = resolve(import.meta.dirname, '../../..');
export const AUDIO_SOURCE_DIR = join(ROOT, 'assets-src', 'audio', 'source');
export const AUDIO_OUT_DIR = join(ROOT, 'assets-src', 'audio', 'generated');
export const SOUND_TABLE = join(ROOT, 'assets-src', 'audio', 'sounds.json');
export const T0_SOUNDS = ['t0-tiro', 't0-impacto', 't0-passo', 't0-ui'] as const;
