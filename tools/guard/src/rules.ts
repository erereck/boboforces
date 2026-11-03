/**
 * Regras de portabilidade aplicadas pelo guard (tecnico.md §3 "como isso é garantido" e §21; docs/PORTABILIDADE.md).
 * São DADOS: nomes proibidos, onde valem e a mensagem. O motor fica em `check.ts`.
 *
 * Escopos: `packages/*` é o código compartilhado; `apps/*` são as cascas (a única fronteira com navegador e nx.js).
 * Testes (`*.test.ts`), `.d.ts`, scripts de build e `tools/*` não vão para o jogo e ficam fora da varredura.
 */

export interface FileInfo {
  /** Caminho relativo à raiz, com `/`. */
  readonly rel: string;
  readonly group: 'packages' | 'apps';
  /** Nome da pasta do workspace (`sim`, `web`, `switch`…). */
  readonly name: string;
}

export type RuleId =
  | 'dom'
  | 'global-root'
  | 'threads'
  | 'network'
  | 'eval'
  | 'commonjs'
  | 'dynamic-import'
  | 'import-meta'
  | 'intl'
  | 'clock'
  | 'webgl-extension'
  | 'three-api'
  | 'audio-api'
  | 'import-three'
  | 'import-three-addon'
  | 'import-trystero'
  | 'import-net'
  | 'import-node'
  | 'import-cross-workspace'
  | 'import-undeclared'
  | 'import-render';

export const RULE_HELP: Readonly<Record<RuleId, string>> = {
  dom: 'API do navegador no código compartilhado: use a Platform (regras 1 a 3)',
  'global-root':
    'globalThis/window/self como valor (alias, desestruturação, Reflect, índice dinâmico) esconde o global: acesse o membro direto ou use a Platform',
  threads: 'sem threads: nada de Worker, SharedArrayBuffer ou Atomics (regra 5)',
  network: 'rede só em packages/net (regra 4)',
  eval: 'sem eval, new Function, .constructor(…) nem setTimeout com texto (regra 15)',
  commonjs: 'só ESM: nada de require (o bundle do Switch precisa ser autocontido)',
  'dynamic-import': 'import() dinâmico só em apps/web e só com especificador literal (regra 15)',
  'import-meta': 'import.meta só nas cascas: assets vêm por caminho lógico pela platform.assets (regra 3)',
  intl: 'sem Intl/toLocale*/localeCompare: formatação e caixa própria (regra 13)',
  clock:
    'sem relógio nem acaso: use o tick e o RNG com semente; de Math só as funções puras, por acesso direto (regra 10)',
  'webgl-extension': 'WebGL2 puro: getExtension só no diagnóstico da casca web (regra 6)',
  'three-api':
    'parte do three proibida: loaders, controles, CSS renderers, composer, WebGPU, áudio, anisotropia, float/half-float, textura comprimida (regras 6 e 7)',
  'audio-api': 'áudio só pelo subconjunto comum: Context, BufferSource, Gain, StereoPanner (regra 9)',
  'import-three': 'three só em packages/render (regra 7)',
  'import-three-addon': 'addons/examples, webgpu e tsl do three são proibidos (regras 6 e 7)',
  'import-trystero': 'trystero só em packages/net (regra 4)',
  'import-net': 'packages/net só pode ser importado por apps/web (regra 4)',
  'import-node': 'módulo do Node no código do jogo',
  'import-cross-workspace': 'import relativo para outro pacote: use @boboforces/<nome>',
  'import-undeclared': 'dependência não declarada no package.json do pacote (grafo em docs/ARCHITECTURE.md §2)',
  'import-render':
    'game só importa @boboforces/render/data (sem three e sem DOM), até para tipos: sem GPU o three não pode carregar e o game compila sem a lib DOM',
};

/** Pacotes que precisam ser determinísticos (regra 10; `world` pela convenção do M0). */
const DETERMINISTIC = new Set(['sim', 'ai', 'nav', 'format', 'world']);

export const isShared = (f: FileInfo): boolean => f.group === 'packages';
export const isDeterministic = (f: FileInfo): boolean => f.group === 'packages' && DETERMINISTIC.has(f.name);
export const isPackage = (f: FileInfo, name: string): boolean => f.group === 'packages' && f.name === name;
export const isApp = (f: FileInfo, name: string): boolean => f.group === 'apps' && f.name === name;
/** O diagnóstico da casca web (GPU, limites) é o único lugar com `getExtension` (WEBGL_debug_renderer_info). */
export const isWebPlatform = (f: FileInfo): boolean => f.rel.startsWith('apps/web/src/platform/');

export interface IdentifierRule {
  readonly id: RuleId;
  readonly names: ReadonlySet<string>;
  /**
   * `free`: só referência livre ao global (não pega `obj.nome`, chave de objeto nem nome declarado no arquivo);
   * `member`: só acesso a membro (`.nome`); `any`: qualquer ocorrência fora de strings e comentários.
   */
  readonly match: 'free' | 'member' | 'any';
  readonly applies: (f: FileInfo) => boolean;
}

/** `new X` */
export interface NewRule {
  readonly id: RuleId;
  readonly names: ReadonlySet<string>;
  readonly applies: (f: FileInfo) => boolean;
}

const set = (...names: string[]): ReadonlySet<string> => new Set(names);
const everywhere = (): boolean => true;

export const IDENTIFIER_RULES: readonly IdentifierRule[] = [
  {
    id: 'dom',
    match: 'free',
    names: set(
      'document',
      'window',
      'navigator',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'caches',
      'history',
      'fetch',
      'XMLHttpRequest',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'matchMedia',
      'getComputedStyle',
      'alert',
      'confirm',
      'prompt',
      // Globais do navegador que o nx.js não tem (ou tem diferente): quebrariam só no console.
      'addEventListener',
      'removeEventListener',
      'dispatchEvent',
      'location',
      'screen',
      'devicePixelRatio',
      'innerWidth',
      'innerHeight',
      'outerWidth',
      'outerHeight',
      'visualViewport',
      'URL',
      'URLSearchParams',
      'Blob',
      'File',
      'FileReader',
      'FormData',
      'Request',
      'Response',
      'Headers',
      'FontFace',
      'createImageBitmap',
      'ImageBitmap',
      'ImageData',
      'BroadcastChannel',
      'MessageChannel',
      'postMessage',
      'Notification',
    ),
    applies: isShared,
  },
  { id: 'dom', match: 'member', names: set('innerHTML', 'outerHTML', 'insertAdjacentHTML'), applies: isShared },
  {
    id: 'threads',
    match: 'free',
    names: set('Worker', 'SharedWorker', 'SharedArrayBuffer', 'Atomics', 'importScripts'),
    applies: everywhere,
  },
  {
    id: 'network',
    match: 'free',
    names: set(
      'WebSocket',
      'RTCPeerConnection',
      'RTCDataChannel',
      'RTCSessionDescription',
      'RTCIceCandidate',
      'EventSource',
      'WebTransport',
    ),
    applies: (f) => !isPackage(f, 'net'),
  },
  { id: 'eval', match: 'free', names: set('eval'), applies: everywhere },
  { id: 'commonjs', match: 'free', names: set('require', '__dirname', '__filename'), applies: everywhere },
  { id: 'intl', match: 'free', names: set('Intl'), applies: isShared },
  {
    id: 'intl',
    match: 'member',
    names: set(
      'toLocaleString',
      'toLocaleDateString',
      'toLocaleTimeString',
      'toLocaleUpperCase',
      'toLocaleLowerCase',
      'localeCompare',
    ),
    applies: isShared,
  },
  {
    id: 'webgl-extension',
    match: 'member',
    names: set('getExtension', 'getSupportedExtensions'),
    applies: (f) => !isWebPlatform(f),
  },
  {
    id: 'three-api',
    match: 'any',
    names: set(
      'TextureLoader',
      'ImageLoader',
      'ImageBitmapLoader',
      'FileLoader',
      'ObjectLoader',
      'CubeTextureLoader',
      'CompressedTextureLoader',
      'DataTextureLoader',
      'AudioLoader',
      'FontLoader',
      'GLTFLoader',
      'KTX2Loader',
      'CSS2DRenderer',
      'CSS3DRenderer',
      'SVGRenderer',
      'OrbitControls',
      'PointerLockControls',
      'TrackballControls',
      'FlyControls',
      'FirstPersonControls',
      'EffectComposer',
      'WebGPURenderer',
      'WebGL1Renderer',
      'AudioListener',
      'PositionalAudio',
      'anisotropy',
      'getMaxAnisotropy',
      // Render target float/half-float e texturas comprimidas não existem sem extensão no WebGL2 do Switch.
      'FloatType',
      'HalfFloatType',
      'CompressedTexture',
      'CompressedArrayTexture',
      'CompressedCubeTexture',
      'KTXLoader',
      'BasisTextureLoader',
      'DDSLoader',
      'PVRLoader',
    ),
    applies: everywhere,
  },
  {
    id: 'audio-api',
    match: 'any',
    names: set(
      'PannerNode',
      'OscillatorNode',
      'AudioWorklet',
      'AudioWorkletNode',
      'HTMLAudioElement',
      'MediaElementAudioSourceNode',
      'createPanner',
      'createOscillator',
      'audioWorklet',
      'createMediaElementSource',
    ),
    applies: everywhere,
  },
];

/**
 * Regra 10 nos pacotes determinísticos, por lista BRANCA: `Date`, `performance` e `crypto` não aparecem de jeito
 * nenhum (nem `Date['now']`, nem alias, nem desestruturação), e `Math` só como `Math.<membro puro>` direto. Assim
 * `Math['random']`, `const { random } = Math` e `const M = Math` caem todos.
 */
export const CLOCK_GLOBALS: ReadonlySet<string> = set('Date', 'performance', 'crypto');
export const MATH_PURE_MEMBERS: ReadonlySet<string> = set(
  'abs',
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atan2',
  'atanh',
  'cbrt',
  'ceil',
  'clz32',
  'cos',
  'cosh',
  'exp',
  'expm1',
  'f16round',
  'floor',
  'fround',
  'hypot',
  'imul',
  'log',
  'log10',
  'log1p',
  'log2',
  'max',
  'min',
  'pow',
  'round',
  'sign',
  'sin',
  'sinh',
  'sqrt',
  'tan',
  'tanh',
  'trunc',
  'E',
  'LN10',
  'LN2',
  'LOG10E',
  'LOG2E',
  'PI',
  'SQRT1_2',
  'SQRT2',
);

export const NEW_RULES: readonly NewRule[] = [
  { id: 'dom', names: set('Image', 'DOMParser', 'OffscreenCanvas'), applies: isShared },
  { id: 'audio-api', names: set('Audio'), applies: everywhere },
];

/**
 * Subcaminhos do render sem three (contrato, presets de céu, texture arrays, viewports): o `game` pode importar
 * VALORES daqui. O teste `render/src/data.test.ts` garante que nada nesse fecho importa three.
 */
export const RENDER_DATA_SPECS: ReadonlySet<string> = new Set(['@boboforces/render/data']);

/** Quem pode usar `import()` dinâmico. */
export const allowsDynamicImport = (f: FileInfo): boolean => isApp(f, 'web');

/** Módulos `three/…` proibidos mesmo dentro de packages/render. */
export function isForbiddenThreeSubpath(spec: string): boolean {
  return (
    spec.startsWith('three/addons') ||
    spec.startsWith('three/examples') ||
    spec === 'three/webgpu' ||
    spec === 'three/tsl' ||
    spec.startsWith('three/webgpu/') ||
    spec.startsWith('three/tsl/')
  );
}
