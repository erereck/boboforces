// Sondas do Teste Zero que não precisam de GL: 8 (FontFace + texto em OffscreenCanvas), 20 (bateria) e 21 (Intl e
// DecompressionStream). Todas são informativas (as regras já evitam depender delas) e assíncronas: rodam depois do
// boot, sem segurar o menu. Cada uma grava uma linha `[t0]`; erro vira `status=falha erro=…`.
import { errorText, ms2, type T0Logger } from './log.ts';

/** "BoboForces T0 deflate" comprimido pelo zlib do Node nos três formatos do `DecompressionStream`. */
export const DECOMPRESSION_SAMPLES: Readonly<Record<'gzip' | 'deflate' | 'deflate-raw', readonly number[]>> = {
  gzip: [
    31, 139, 8, 0, 0, 0, 0, 0, 2, 10, 115, 202, 79, 202, 119, 203, 47, 74, 78, 45, 86, 8, 49, 80, 72, 73, 77, 203, 73,
    44, 73, 5, 0, 19, 133, 121, 193, 21, 0, 0, 0,
  ],
  deflate: [
    120, 218, 115, 202, 79, 202, 119, 203, 47, 74, 78, 45, 86, 8, 49, 80, 72, 73, 77, 203, 73, 44, 73, 5, 0, 82, 2, 7,
    126,
  ],
  'deflate-raw': [115, 202, 79, 202, 119, 203, 47, 74, 78, 45, 86, 8, 49, 80, 72, 73, 77, 203, 73, 44, 73, 5, 0],
};
export const DECOMPRESSION_TEXT = 'BoboForces T0 deflate';

interface StreamPair {
  readonly writable: { getWriter(): { write(b: Uint8Array): Promise<void>; close(): Promise<void> } };
  readonly readable: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } };
}

async function inflate(Ctor: new (format: string) => StreamPair, format: string, bytes: Uint8Array): Promise<string> {
  const ds = new Ctor(format);
  const writer = ds.writable.getWriter();
  void writer.write(bytes).catch(() => {});
  void writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const parts: number[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) for (const b of value) parts.push(b);
  }
  return new TextDecoder().decode(new Uint8Array(parts));
}

/** Item 21: `Intl` e `DecompressionStream` (informativos: o jogo não usa nenhum dos dois, regras 13 e 23). */
export async function probeIntlAndDecompression(
  log: T0Logger,
  globals: Readonly<Record<string, unknown>>,
): Promise<void> {
  const fields: Record<string, string | number | boolean> = {};
  const intl = globals['Intl'] as
    { NumberFormat?: new (locale: string) => { format(n: number): string }; DateTimeFormat?: unknown } | undefined;
  fields['intl'] = typeof intl === 'object' && intl !== null;
  if (intl?.NumberFormat) {
    try {
      fields['numero_ptbr'] = new intl.NumberFormat('pt-BR').format(1234.5);
    } catch (error) {
      fields['numero_ptbr'] = `erro: ${errorText(error)}`;
    }
  }
  fields['datas'] = typeof intl?.DateTimeFormat === 'function';
  const Ds = globals['DecompressionStream'] as (new (format: string) => StreamPair) | undefined;
  fields['decompression'] = typeof Ds === 'function';
  let allOk = typeof Ds === 'function';
  if (typeof Ds === 'function') {
    for (const [format, bytes] of Object.entries(DECOMPRESSION_SAMPLES)) {
      const key = format.replace('-', '_');
      try {
        const text = await inflate(Ds, format, new Uint8Array(bytes));
        fields[key] = text === DECOMPRESSION_TEXT ? 'ok' : 'diferente';
        if (text !== DECOMPRESSION_TEXT) allOk = false;
      } catch (error) {
        fields[key] = errorText(error);
        allOk = false;
      }
    }
  }
  log(21, 'info', { ...fields, decompression_ok: allOk });
}

interface OffscreenLike {
  getContext(id: '2d'): {
    font: string;
    fillStyle: string;
    textBaseline: string;
    fillText(text: string, x: number, y: number): void;
    measureText(text: string): { width: number };
    getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray | Uint8Array };
  } | null;
}

/**
 * Item 8: `FontFace` + `fonts.add()` desenhando em `OffscreenCanvas` (informativo: o texto do jogo é MSDF). Não há
 * fonte TTF no romfs (regra 23: só PNG, MP3 e binários próprios), então a sonda confere a API e desenha com a fonte do
 * sistema (`system-ui`, que o nx.js já registra em `fonts`), contando os pixels pintados.
 */
export function probeFontFace(log: T0Logger, globals: Readonly<Record<string, unknown>>, now: () => number): void {
  const FontFaceCtor = globals['FontFace'];
  const fonts = globals['fonts'] as { add?: unknown; check?: (font: string) => boolean; size?: number } | undefined;
  const Offscreen = globals['OffscreenCanvas'] as (new (w: number, h: number) => OffscreenLike) | undefined;
  const fields: Record<string, string | number | boolean> = {
    fontface: typeof FontFaceCtor === 'function',
    fonts_add: typeof fonts?.add === 'function',
    fonts_qtd: typeof fonts?.size === 'number' ? fonts.size : -1,
  };
  try {
    if (typeof fonts?.check === 'function') fields['system_ui'] = fonts.check('24px system-ui');
  } catch (error) {
    fields['system_ui'] = `erro: ${errorText(error)}`;
  }
  if (typeof Offscreen !== 'function') {
    log(8, 'falha', { ...fields, offscreen: false });
    return;
  }
  try {
    const t0 = now();
    const canvas = new Offscreen(128, 32);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas sem contexto 2D');
    ctx.font = '24px system-ui';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.fillText('BoboForces', 2, 2);
    const width = ctx.measureText('BoboForces').width;
    const data = ctx.getImageData(0, 0, 128, 32).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) painted++;
    log(8, painted > 0 ? 'info' : 'falha', {
      ...fields,
      offscreen: true,
      largura_texto: Math.round(width),
      pixels_pintados: painted,
      ms: ms2(now() - t0),
    });
  } catch (error) {
    log(8, 'falha', { ...fields, offscreen: true, erro: errorText(error) });
  }
}

/** Item 20 (parte): `navigator.getBattery()`; o resto do item são as linhas do ciclo de vida. */
export async function probeBattery(
  log: T0Logger,
  getBattery: (() => Promise<{ level: number; charging: boolean }>) | undefined,
  event: string,
  mode: string,
): Promise<void> {
  if (typeof getBattery !== 'function') {
    log(20, 'falha', { evento: event, bateria: false });
    return;
  }
  try {
    const b = await getBattery();
    log(20, 'info', {
      evento: event,
      modo: mode,
      bateria: true,
      nivel: Math.round(b.level * 100),
      carregando: b.charging,
    });
  } catch (error) {
    log(20, 'falha', { evento: event, bateria: true, erro: errorText(error) });
  }
}
