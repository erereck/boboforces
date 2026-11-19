import { deflateSync, Inflate, strFromU8, strToU8 } from 'fflate';

/**
 * M8 (fase 0): os códigos de compartilhar (GDD §4.8, tecnico.md §14.3): `<prefixo>` + base64url(deflate(JSON)). O bot
 * é `BF1-`, o preset `BFP1-`, o esquadrão `BFS1-` e a semente do Surpreenda-me `BFR1-`; o número é a versão do código
 * (o JSON dentro tem a dele, `format`). Nos links, o bot vai em `#bot=` e o preset em `#p=` (sem o prefixo): o hash não
 * sai do aparelho. Tudo que chega é entrada de estranho: o texto tem teto, o inflate tem teto (anti-bomba) e o JSON
 * ainda passa pelo validador do tipo dele.
 */
export const SHARE_CODE_PREFIX = { bot: 'BF1-', preset: 'BFP1-', squad: 'BFS1-', surprise: 'BFR1-' } as const;
export type ShareKind = keyof typeof SHARE_CODE_PREFIX;
const SHARE_KINDS = Object.keys(SHARE_CODE_PREFIX) as readonly ShareKind[];

/** GDD §4.8: o código tem no máximo 4.000 caracteres (o prefixo incluso). */
export const SHARE_CODE_MAX_CHARS = 4000;
/** O JSON descompactado tem no máximo 64 KB (o teto do arquivo da Oficina). */
export const SHARE_JSON_MAX_BYTES = 64 * 1024;

/** As chaves do hash dos links (só o bot e o preset têm link: GDD §4.8). */
export const SHARE_LINK_KEY: Readonly<Partial<Record<ShareKind, string>>> = { bot: 'bot', preset: 'p' };

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const DECODE = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET.charCodeAt(i)] = i;

/** base64url sem `=` (o alfabeto de URL: `-` e `_`). Sem `btoa` (não existe em todo runtime). */
export function encodeBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]!;
  }
  return out;
}

/** O contrário de `encodeBase64Url`; `null` com caractere fora do alfabeto ou um tamanho impossível. */
export function decodeBase64Url(text: string): Uint8Array | null {
  const len = text.length;
  if (len % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    let n = 0;
    const k = Math.min(4, len - i);
    for (let j = 0; j < 4; j++) {
      let v = 0;
      if (j < k) {
        const c = text.charCodeAt(i + j);
        v = c < 128 ? DECODE[c]! : -1;
        if (v < 0) return null;
      }
      n = (n << 6) | v;
    }
    out[o++] = (n >> 16) & 255;
    if (k > 2) out[o++] = (n >> 8) & 255;
    if (k > 3) out[o++] = n & 255;
  }
  return out;
}

export type ShareEncodeResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly error: 'tooLong'; readonly chars: number };

/** O código de um documento (o JSON compacto, deflate no nível 9). Passou de 4.000 caracteres: `tooLong`. */
export function encodeShareCode(kind: ShareKind, doc: unknown): ShareEncodeResult {
  const bytes = deflateSync(strToU8(JSON.stringify(doc)), { level: 9 });
  const code = SHARE_CODE_PREFIX[kind] + encodeBase64Url(bytes);
  return code.length > SHARE_CODE_MAX_CHARS ? { ok: false, error: 'tooLong', chars: code.length } : { ok: true, code };
}

/**
 * Por que o código não abriu: sem prefixo conhecido, longo demais, base64 quebrado, deflate quebrado, grande demais
 * descompactado, ou não é JSON.
 */
export type ShareDecodeError = 'prefix' | 'tooLong' | 'base64' | 'inflate' | 'tooBig' | 'json';

export type ShareDecodeResult =
  | { readonly ok: true; readonly kind: ShareKind; readonly doc: unknown }
  | { readonly ok: false; readonly error: ShareDecodeError };

/** O tipo de um texto pelo prefixo (sem olhar o resto), sem diferenciar maiúsculas; `null` = não é código. */
export function shareKindOf(text: string): ShareKind | null {
  const t = text.trimStart().slice(0, 8).toUpperCase();
  for (const kind of SHARE_KINDS) if (t.startsWith(SHARE_CODE_PREFIX[kind])) return kind;
  return null;
}

/**
 * Abre um código colado (espaços e quebras de linha no meio são ignorados: o código pode ter vindo quebrado de uma
 * conversa). O documento volta cru: quem chama passa pelo validador do tipo.
 */
export function decodeShareCode(text: string): ShareDecodeResult {
  // Espaços, quebras de linha e os invisíveis que alguns apps põem (hífen suave, largura zero) saem.
  const clean = text.replace(/[\s­​-‍⁠﻿]+/gu, '');
  const kind = shareKindOf(clean);
  if (kind === null) return { ok: false, error: 'prefix' };
  if (clean.length > SHARE_CODE_MAX_CHARS) return { ok: false, error: 'tooLong' };
  const bytes = decodeBase64Url(clean.slice(SHARE_CODE_PREFIX[kind].length));
  if (bytes === null || bytes.length === 0) return { ok: false, error: 'base64' };
  const raw = inflateBounded(bytes, SHARE_JSON_MAX_BYTES);
  if (raw === 'inflate' || raw === 'tooBig') return { ok: false, error: raw };
  let doc: unknown;
  try {
    doc = JSON.parse(strFromU8(raw));
  } catch {
    return { ok: false, error: 'json' };
  }
  return { ok: true, kind, doc };
}

/** Inflate em fatias com teto de saída (como o do `.bfmap`): passou do teto, para antes de alocar o resto. */
function inflateBounded(bytes: Uint8Array, limit: number): Uint8Array | 'inflate' | 'tooBig' {
  const parts: Uint8Array[] = [];
  let total = 0;
  let over = false;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > limit) {
      over = true;
      throw new RangeError('share: passou do teto');
    }
    parts.push(chunk);
  });
  const STEP = 1024;
  try {
    for (let i = 0; i < bytes.length; i += STEP) inflater.push(bytes.subarray(i, i + STEP), i + STEP >= bytes.length);
  } catch {
    return over ? 'tooBig' : 'inflate';
  }
  if (parts.length === 0) return 'inflate';
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** O hash do link de um código (`#bot=…`, `#p=…`); `null` para os tipos sem link. */
export function shareLinkHash(code: string): string | null {
  const kind = shareKindOf(code);
  if (kind === null) return null;
  const key = SHARE_LINK_KEY[kind];
  return key === undefined ? null : `#${key}=${code.trim().slice(SHARE_CODE_PREFIX[kind].length)}`;
}

/**
 * O código que um hash de link traz (`#bot=…` ou `#p=…`, também no meio de outros parâmetros: `#x=1&p=…`); `null` sem
 * link de código. A casca da web lê o hash uma vez e limpa a barra (regra 3: o `format` só vê a string).
 */
export function shareCodeFromHash(hash: string): string | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of body.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    for (const kind of SHARE_KINDS) {
      if (SHARE_LINK_KEY[kind] === key) return SHARE_CODE_PREFIX[kind] + part.slice(eq + 1);
    }
  }
  return null;
}
