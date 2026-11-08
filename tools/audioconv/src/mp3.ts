// Codificador MP3 da ferramenta (lamejs, LGPL-3.0, só na máquina de quem gera os assets; não vai no jogo).
// Decisão #47 + regra 23: os sons CC0 da Kenney vêm em OGG e o jogo só aceita MP3. A DECODIFICAÇÃO do OGG é feita
// pelo Edge via playwright-core (frente switch-audio, `decode.ts`); aqui só PCM → MP3.
import { Mp3Encoder } from '@breezystack/lamejs';

/** Padrão do jogo: mono, 44,1 kHz, 96 kbps (efeitos curtos; teto de 1,5 MB para ~40 sons, GDD §5.10). */
export const MP3_DEFAULTS = { sampleRate: 44100, kbps: 96 } as const;

/** Bloco que o LAME aceita por chamada (múltiplo de 576 amostras). */
const BLOCK = 1152;

/** PCM mono em float (-1..1) → bytes de MP3 (CBR). Determinístico para a mesma entrada. */
export function encodeMp3(
  pcm: Float32Array,
  sampleRate: number = MP3_DEFAULTS.sampleRate,
  kbps: number = MP3_DEFAULTS.kbps,
): Uint8Array {
  const encoder = new Mp3Encoder(1, sampleRate, kbps);
  const chunks: Uint8Array[] = [];
  const block = new Int16Array(BLOCK);
  for (let i = 0; i < pcm.length; i += BLOCK) {
    const n = Math.min(BLOCK, pcm.length - i);
    for (let j = 0; j < n; j++) {
      const s = Math.max(-1, Math.min(1, pcm[i + j]!));
      block[j] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    }
    const out = encoder.encodeBuffer(n === BLOCK ? block : block.subarray(0, n));
    if (out.length > 0) chunks.push(new Uint8Array(out));
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(new Uint8Array(tail));
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    bytes.set(c, o);
    o += c.length;
  }
  return bytes;
}
