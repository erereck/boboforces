/**
 * Manifesto de camadas dos texture arrays (`blocos16` e `modelos64`; tecnico.md §6.1, arte-ux.md §1.6). CONTRATO DO
 * M1, implementado aqui (é a cola entre três ferramentas e o render).
 *
 * Cada ferramenta grava a SUA tira, que entra num dos dois arrays:
 *   <base>.png       nível 0: camadas de W×H empilhadas na vertical (camada i nas linhas [i·H, (i+1)·H))
 *   <base>.mips.png  níveis 1..n−1 (só se `mipLevels` > 1): largura W/2; cada camada ocupa um bloco de H linhas; dentro
 *                    do bloco, o nível k começa na linha H − H/2^(k−1) e ocupa W/2^k × H/2^k a partir da coluna 0
 *                    (sobra a última linha do bloco, transparente). `mipChainOffsets` faz a conta.
 *   <base>.json      este manifesto.
 * O runtime concatena as tiras de cada array NA ORDEM de `arrays` do `assets-src/runtime-assets.json` e resolve as
 * camadas SEMPRE por nome (`assembleTextureArray` em `@boboforces/render/data`). Nome repetido entre tiras do mesmo
 * array é erro.
 *
 * Nos mips de camada `cutout`, a ferramenta preserva a cobertura do alfa (a cerca e a folhagem não somem ao longe).
 */
export const LAYER_MANIFEST_FORMAT = 'boboforces/layers@1';

export const TEXTURE_ARRAY_NAMES = ['blocos16', 'modelos64'] as const;
export type TextureArrayName = (typeof TEXTURE_ARRAY_NAMES)[number];

export interface TextureArraySpec {
  readonly layerSize: number;
  /** Teto de camadas (tecnico.md §6.1; `modelos64` sobe se o Teste Zero deixar). */
  readonly maxLayers: number;
  /** Cadeia completa de mips (16 → 1 e 64 → 1). Toda tira do array declara esse número. */
  readonly mipLevels: number;
}

export const TEXTURE_ARRAYS: Readonly<Record<TextureArrayName, TextureArraySpec>> = {
  blocos16: { layerSize: 16, maxLayers: 256, mipLevels: 5 },
  modelos64: { layerSize: 64, maxLayers: 128, mipLevels: 7 },
};

/**
 * Camadas de `modelos64` reservadas no FIM do array para as skins compostas no loading (`Renderer.writeModelLayer`).
 * Cada skin do boneco do FutBobo ocupa `FIGURE_SKIN_LAYERS` (2) camadas seguidas (#56): 64 camadas = 32 skins de 2
 * camadas (o `game` reserva os looks da partida no loading; o Switch 3–4P com 16 bots e 4 humanos usa 10). O
 * `modelos64` fica com 88 de 128 camadas (9 de materiais, 15 de modelos e a reserva). No M2 (aparência por bot) a
 * reserva passa a vir do perfil, com o teto do array em 256 (mínimo do WebGL2).
 */
export const SKIN_LAYER_RESERVE = 64;

/** Quem gerou a tira (para mensagens e para o `assets`). */
export type LayerSource = 'texgen' | 'modelgen';

/** Tipo de camada: o programa que a usa e como os mips são feitos. */
export type LayerKind = 'opaque' | 'cutout' | 'translucent' | 'emissive';

export interface LayerEntry {
  /** Nome estável da camada (minúsculas, dígitos, `_` e `-`). Camada publicada nunca muda de nome. */
  readonly name: string;
  readonly kind: LayerKind;
  /** Quadros de animação a partir desta camada (1 = estática). As seguintes não ganham entrada própria. */
  readonly frames: number;
  /** Mips com cobertura de alfa preservada (folha, cerca, camada externa). */
  readonly cutout: boolean;
}

export interface LayerManifest {
  readonly format: typeof LAYER_MANIFEST_FORMAT;
  readonly array: TextureArrayName;
  readonly source: LayerSource;
  readonly layerWidth: number;
  readonly layerHeight: number;
  /** Níveis presentes (contando o 0). 1 = sem `.mips.png`. */
  readonly mipLevels: number;
  /**
   * Uma entrada por camada FÍSICA da tira, na ordem; quadros de animação seguintes repetem o nome com sufixo
   * `#<quadro>` (ex.: `water`, `water#1`, `water#2`), para o total bater com a altura do PNG.
   */
  readonly layers: readonly LayerEntry[];
  /** Arquivo provisório da etapa de contratos: o runtime recusa com "rode npm run assets". */
  readonly placeholder?: boolean;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}(#[0-9]{1,2})?$/;
const KINDS: readonly LayerKind[] = ['opaque', 'cutout', 'translucent', 'emissive'];
// O `skingen` não gera mais tira (a folha de rostos do bobo A saiu com o porte do boneco, #56).
const SOURCES: readonly LayerSource[] = ['texgen', 'modelgen'];

function fail(message: string): never {
  throw new Error(`manifesto de camadas: ${message}`);
}

/** Valida e normaliza o JSON de um manifesto. Lança com a mensagem do primeiro problema. */
export function parseLayerManifest(json: unknown): LayerManifest {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) fail('não é um objeto');
  const m = json as Record<string, unknown>;
  if (m['format'] !== LAYER_MANIFEST_FORMAT) fail(`format precisa ser "${LAYER_MANIFEST_FORMAT}"`);
  const array = m['array'];
  if (array !== 'blocos16' && array !== 'modelos64') fail(`array desconhecido: ${String(array)}`);
  const spec = TEXTURE_ARRAYS[array];
  const source = m['source'];
  if (!SOURCES.includes(source as LayerSource)) fail(`source desconhecido: ${String(source)}`);
  const placeholder = m['placeholder'] === true;
  const { layerWidth, layerHeight, mipLevels } = m;
  if (layerWidth !== spec.layerSize || layerHeight !== spec.layerSize) {
    fail(`${array} exige camadas de ${spec.layerSize}×${spec.layerSize}`);
  }
  if (typeof mipLevels !== 'number' || !Number.isInteger(mipLevels) || mipLevels < 1 || mipLevels > spec.mipLevels) {
    fail(`mipLevels precisa ser 1..${spec.mipLevels}`);
  }
  const list = m['layers'];
  if (!Array.isArray(list)) fail('sem layers');
  if (list.length > spec.maxLayers) fail(`${list.length} camadas (teto de ${array}: ${spec.maxLayers})`);
  const seen = new Set<string>();
  const layers: LayerEntry[] = list.map((raw: unknown, i) => {
    if (typeof raw !== 'object' || raw === null) fail(`camada ${i} não é objeto`);
    const e = raw as Record<string, unknown>;
    const name = e['name'];
    if (typeof name !== 'string' || !NAME_RE.test(name)) fail(`camada ${i} com nome inválido: ${String(name)}`);
    if (seen.has(name)) fail(`camada "${name}" repetida`);
    seen.add(name);
    const kind = e['kind'] ?? 'opaque';
    if (!KINDS.includes(kind as LayerKind)) fail(`camada "${name}" com kind inválido: ${String(kind)}`);
    const frames = e['frames'] ?? 1;
    if (typeof frames !== 'number' || !Number.isInteger(frames) || frames < 1 || frames > 16) {
      fail(`camada "${name}" com frames inválido`);
    }
    const cutout = e['cutout'] ?? kind === 'cutout';
    if (typeof cutout !== 'boolean') fail(`camada "${name}" com cutout inválido`);
    return { name, kind: kind as LayerKind, frames, cutout };
  });
  if (!placeholder && layers.length === 0) fail('nenhuma camada');
  const out: LayerManifest = {
    format: LAYER_MANIFEST_FORMAT,
    array,
    source: source as LayerSource,
    layerWidth: spec.layerSize,
    layerHeight: spec.layerSize,
    mipLevels,
    layers,
  };
  return placeholder ? { ...out, placeholder: true } : out;
}

/** Retângulo de um nível de mip dentro do bloco da camada no `.mips.png` (px; `y` relativo ao início do bloco). */
export interface MipRect {
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Onde cada nível 1..`mipLevels`−1 fica no bloco de uma camada do `.mips.png` (camada `i` começa na linha `i · H`).
 * Ex.: 16×16 com 5 níveis → nível 1 (8×8) na linha 0, nível 2 (4×4) na 8, nível 3 (2×2) na 12, nível 4 (1×1) na 14.
 */
export function mipChainOffsets(layerSize: number, mipLevels: number): readonly MipRect[] {
  const out: MipRect[] = [];
  let y = 0;
  for (let level = 1; level < mipLevels; level++) {
    const size = Math.max(1, layerSize >> level);
    out.push({ level, x: 0, y, width: size, height: size });
    y += size;
  }
  return out;
}
