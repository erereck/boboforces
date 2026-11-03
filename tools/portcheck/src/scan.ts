/**
 * Varredura do bundle do Switch (tecnico.md §3, item 3): identificadores que NUNCA podem ir para o Switch, mesmo
 * dentro de dependências (three, fflate…). Comentários e strings não contam (mesmo tokenizador do guard).
 *
 * Disfarces cobertos: `globalThis.fetch` (raiz global + membro) e `g["localStorage"]` (texto entre colchetes vale
 * como o nome).
 *
 * O que fica de fora de propósito: `document`, `window`, `navigator`, `self` e `getExtension` aparecem no three,
 * sempre atrás de `typeof` ou só no caminho do WebGLRenderer; quem garante que o NOSSO código não os usa é o guard,
 * e o boot em `node:vm` (que só tem os globais do nx.js) pega o que for executado de verdade.
 */
import { tokenize, type Token } from '../../guard/src/lexer.ts';

export type BundleRule = 'rede' | 'threads' | 'armazenamento' | 'eval' | 'node' | 'modulos' | 'wasm' | 'p2p';

export interface BundleFinding {
  readonly rule: BundleRule;
  readonly what: string;
  /** Posição no bundle (1-based). */
  readonly line: number;
  readonly col: number;
}

export const BUNDLE_RULE_HELP: Readonly<Record<BundleRule, string>> = {
  rede: 'o Switch é 100% offline (decisão #1): nenhum byte de rede no bundle',
  threads: 'sem threads (regra 5)',
  armazenamento: 'save só pelo SD (platform.storage); localStorage no bundle ainda liga a tela de perfil no NSP',
  eval: 'sem eval nem new Function (regra 15)',
  node: 'resto de API do Node: o nx.js não tem',
  modulos: 'o bundle do Switch precisa ser um arquivo só, sem import()/import.meta/require',
  wasm: 'sem WASM no caminho crítico (tecnico.md §2.1)',
  p2p: 'código de rede P2P (trystero/nostr) no bundle do Switch',
};

/** Qualquer ocorrência (livre ou membro). */
const ANY: ReadonlyMap<string, BundleRule> = new Map<string, BundleRule>([
  ['WebSocket', 'rede'],
  ['RTCPeerConnection', 'rede'],
  ['RTCDataChannel', 'rede'],
  ['RTCSessionDescription', 'rede'],
  ['RTCIceCandidate', 'rede'],
  ['EventSource', 'rede'],
  ['WebTransport', 'rede'],
  ['XMLHttpRequest', 'rede'],
  ['Worker', 'threads'],
  ['SharedWorker', 'threads'],
  ['SharedArrayBuffer', 'threads'],
  ['Atomics', 'threads'],
  ['importScripts', 'threads'],
  ['localStorage', 'armazenamento'],
  ['sessionStorage', 'armazenamento'],
  ['indexedDB', 'armazenamento'],
  ['WebAssembly', 'wasm'],
]);

/**
 * Só como referência livre ou pela raiz global (como membro de outro objeto são nomes comuns: `obj.process()`,
 * `x.require`, `loader.fetch`).
 */
const FREE: ReadonlyMap<string, BundleRule> = new Map<string, BundleRule>([
  // Assets do Switch vêm do RomFS (Switch.readFileSync); fetch no bundle só serviria para a rede.
  ['fetch', 'rede'],
  ['eval', 'eval'],
  ['Function', 'eval'],
  ['require', 'node'],
  ['process', 'node'],
  ['Buffer', 'node'],
  ['__dirname', 'node'],
  ['__filename', 'node'],
]);

const P2P = /trystero|nostr/i;

const GLOBAL_ROOTS = new Set(['globalThis', 'window', 'self', 'global']);

const isDot = (t: Token | undefined): boolean => t?.kind === 'punct' && (t.value === '.' || t.value === '?.');
const isPunct = (t: Token | undefined, v: string): boolean => t?.kind === 'punct' && t.value === v;

export function scanBundle(code: string): BundleFinding[] {
  const { tokens } = tokenize(code);
  const out: BundleFinding[] = [];
  const add = (rule: BundleRule, what: string, t: Token): void => {
    out.push({ rule, what, line: t.line, col: t.col });
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    // `g["localStorage"]`, `globalThis['fetch']`: o texto entre colchetes é o nome acessado.
    if ((t.kind === 'string' || t.kind === 'template') && isPunct(prev, '[') && isPunct(next, ']')) {
      const rule = ANY.get(t.value) ?? FREE.get(t.value);
      if (rule) add(rule, `[${JSON.stringify(t.value)}]`, t);
      continue;
    }
    if (t.kind !== 'ident') continue;
    const anyRule = ANY.get(t.value);
    if (anyRule) add(anyRule, t.value, t);
    const freeRule = FREE.get(t.value);
    // Chave de objeto (`{ process: 1 }`) também não é uso do global.
    const isKey = next?.kind === 'punct' && next.value === ':' && prev?.kind === 'punct' && /[{,]/.test(prev.value);
    const root = tokens[i - 2];
    const rootMember = isDot(prev) && root?.kind === 'ident' && GLOBAL_ROOTS.has(root.value) && !isDot(tokens[i - 3]);
    if (freeRule && t.value !== 'Function' && ((!isDot(prev) && !isKey) || rootMember)) {
      add(freeRule, rootMember ? `${root.value}.${t.value}` : t.value, t);
    }
    if (P2P.test(t.value)) add('p2p', t.value, t);
    if (t.value === 'Function' && (!isDot(prev) || rootMember)) {
      const isNew = prev?.kind === 'ident' && prev.value === 'new';
      if (isNew || (next?.kind === 'punct' && next.value === '('))
        add('eval', isNew ? 'new Function' : 'Function()', t);
    }
    if (t.value === 'import' && !isDot(prev) && next?.kind === 'punct') {
      if (next.value === '(') add('modulos', 'import()', t);
      else if (next.value === '.') add('modulos', 'import.meta', t);
      else if (next.value === '{' || next.value === '*') add('modulos', 'import estático', t);
    }
    if (t.value === 'import' && !isDot(prev) && next?.kind === 'string') add('modulos', 'import estático', t);
    const exportsSomething =
      (next?.kind === 'punct' && next.value === '{') || (next?.kind === 'ident' && next.value === 'default');
    if (t.value === 'export' && !isDot(prev) && exportsSomething) add('modulos', 'export', t);
  }
  return out;
}
