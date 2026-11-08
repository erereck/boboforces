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
  | 'import-render'
  | 'import-tooling'
  | 'asset-format'
  | 'hot-loop';

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
    'do código compartilhado, só o game enxerga o render, e só por @boboforces/render/data (sem three e sem DOM), até para tipos: sem GPU o three não pode carregar e o game compila sem a lib DOM; as cascas injetam o renderer',
  'import-tooling':
    'ferramenta de build/teste no código do jogo: tools/* e dependências de desenvolvimento (vite, vitest, playwright-core, esbuild, typescript, prettier, lamejs) rodam só na máquina e nunca entram no bundle (a lamejs é LGPL)',
  'asset-format':
    'asset em tempo de execução fora do formato: só PNG, MP3, JSON de manifesto e binários próprios (.bfmap, .bfmodel), com a mesma extensão no caminho lógico e no arquivo (regra 23)',
  'hot-loop':
    'laço quente (entre `// quente:` e `// fim-quente`) não aloca: sem `new`, literal de array ou objeto, arrow function, .map/.filter/.forEach/.slice/.concat, template string nem spread; use rascunhos e pools (regra 11)',
};

/**
 * Marcadores do laço quente (regra 11; PLANO do porte, E.9): um comentário cujo texto COMEÇA com `quente:` abre a
 * região e um que começa com `fim-quente` fecha. Vale em todo arquivo varrido (packages e cascas).
 */
export const HOT_LOOP_OPEN = /^\s*quente:/;
export const HOT_LOOP_CLOSE = /^\s*fim-quente\b/;
/** Métodos proibidos na região quente: devolvem array novo ou pedem closure por chamada. */
export const HOT_LOOP_MEMBERS: ReadonlySet<string> = new Set(['map', 'filter', 'forEach', 'slice', 'concat']);
/**
 * Funções que o E.9 do porte põe no laço quente: onde houver `function <nome>` com corpo, o corpo tem de cruzar uma
 * região quente. Sem isto, apagar os marcadores desligaria a regra sem aviso.
 */
export const HOT_LOOP_REQUIRED_FUNCTIONS: ReadonlySet<string> = new Set([
  'figureFk',
  'figureHitBoxes',
  'figureGamePose',
  'paintFigureSkin',
  'rayVsBobo',
]);
/** Arquivos do E.9 que, quando existem, precisam de ao menos uma região quente (o motor e o passe de instâncias). */
export const HOT_LOOP_REQUIRED_FILES: readonly RegExp[] = [
  /^packages\/render\/src\/actors\/anim\/rig\.ts$/,
  /^packages\/render\/src\/actors\/figure-instances\.ts$/,
];

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

/**
 * Pacotes de desenvolvimento que nunca entram no código do jogo (`packages/*\/src`, `apps/*\/src`, sem testes): o
 * bundle do Switch e o da web têm que ser autocontidos, e a `@breezystack/lamejs` (LGPL-3.0, só no `tools/audioconv`)
 * não pode ser distribuída junto. Os workspaces de `tools/*` entram pela mesma regra (ver `check.ts`).
 */
export const TOOLING_PACKAGES: ReadonlySet<string> = set(
  'vite',
  'vitest',
  'playwright',
  'playwright-core',
  'esbuild',
  'typescript',
  'prettier',
  '@breezystack/lamejs',
  'lamejs',
);

export const isToolingPackage = (pkg: string): boolean =>
  TOOLING_PACKAGES.has(pkg) || pkg.startsWith('@vitest/') || pkg.startsWith('@vitejs/') || pkg.startsWith('@types/');

/** Extensões aceitas nos assets em tempo de execução (regra 23; JSON só para manifestos). */
export const RUNTIME_ASSET_EXTENSIONS: ReadonlySet<string> = set('.png', '.mp3', '.json', '.bfmap', '.bfmodel');

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
