// Decodificação dos OGG no Edge instalado (playwright-core, sem baixar navegador; como o `smoke:web`): o
// `OfflineAudioContext` do Chromium decodifica Vorbis, reamostra para a taxa pedida e soma os canais em mono ao
// renderizar com 1 canal. Só na máquina de quem gera os assets; nada disso vai no jogo.
import { chromium, type Browser } from 'playwright-core';

export interface DecodedAudio {
  readonly pcm: Float32Array;
  readonly sampleRate: number;
  /** Canais e taxa do arquivo original. */
  readonly sourceChannels: number;
  readonly sourceRate: number;
}

/** M2 (fase 7d): os 2 canais (a música é estéreo); mono no original vira os 2 iguais. */
export interface DecodedStereo {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
  readonly sourceChannels: number;
  readonly sourceRate: number;
}

export interface Decoder {
  decode(bytes: Uint8Array, sampleRate: number): Promise<DecodedAudio>;
  decodeStereo(bytes: Uint8Array, sampleRate: number): Promise<DecodedStereo>;
  close(): Promise<void>;
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'msedge', headless: true });
  } catch {
    // Fora do Windows do Erick: o Chrome instalado também serve.
    return chromium.launch({ channel: 'chrome', headless: true });
  }
}

/** Abre o Edge headless uma vez para todos os arquivos. */
export async function createDecoder(): Promise<Decoder> {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>audioconv</title>');
  return {
    async decode(bytes, sampleRate) {
      const result = await page.evaluate(
        async ({ b64, rate }) => {
          const bin = atob(b64);
          const data = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
          const probe = new OfflineAudioContext(1, 1, rate);
          const buffer = await probe.decodeAudioData(data.buffer);
          const length = Math.ceil(buffer.duration * rate);
          const ctx = new OfflineAudioContext(1, length, rate);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start();
          const out = (await ctx.startRendering()).getChannelData(0);
          const raw = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
          let s = '';
          for (let i = 0; i < raw.length; i += 0x8000) s += String.fromCharCode(...raw.subarray(i, i + 0x8000));
          return { b64: btoa(s), channels: buffer.numberOfChannels, sourceRate: buffer.sampleRate };
        },
        { b64: Buffer.from(bytes).toString('base64'), rate: sampleRate },
      );
      const raw = Buffer.from(result.b64, 'base64');
      const pcm = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      return { pcm, sampleRate, sourceChannels: result.channels, sourceRate: result.sourceRate };
    },
    async decodeStereo(bytes, sampleRate) {
      const r = await page.evaluate(
        async ({ b64, rate }) => {
          const bin = atob(b64);
          const data = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
          const probe = new OfflineAudioContext(2, 1, rate);
          const buffer = await probe.decodeAudioData(data.buffer);
          const length = Math.ceil(buffer.duration * rate);
          const ctx = new OfflineAudioContext(2, length, rate);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start();
          const out = await ctx.startRendering();
          const enc = (a: Float32Array): string => {
            const raw = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
            let s = '';
            for (let i = 0; i < raw.length; i += 0x8000) s += String.fromCharCode(...raw.subarray(i, i + 0x8000));
            return btoa(s);
          };
          return {
            l: enc(out.getChannelData(0)),
            r: enc(out.getChannelData(1)),
            channels: buffer.numberOfChannels,
            sourceRate: buffer.sampleRate,
          };
        },
        { b64: Buffer.from(bytes).toString('base64'), rate: sampleRate },
      );
      const dec = (s: string): Float32Array => {
        const raw = Buffer.from(s, 'base64');
        return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      };
      return { left: dec(r.l), right: dec(r.r), sampleRate, sourceChannels: r.channels, sourceRate: r.sourceRate };
    },
    close: () => browser.close(),
  };
}
