/**
 * fontbake: gera o atlas MSDF da UI a partir das fontes OFL de `assets-src/fonts/` (tecnico.md §9 e §15.1; decisão
 * #54). Parâmetros em `spec.ts`.
 *
 * Saída em `assets-src/fonts/generated/`:
 * - `ui-fonts.generated.png`: tira vertical (RGB quando opaca), uma camada de 512×256 por fonte (vira um
 *   `TEXTURE_2D_ARRAY`). A `display` leva só caixa alta (`codepointsForRole`); a camada do HUD sai em 7 bits;
 * - `ui-fonts.generated.json`: métricas no formato `boboforces/ui-fonts@1` (lido por `parseFontPack` do `ui`), com o
 *   nome derivado de cada fonte, `license` e `source`;
 * - `ui-fonts.licencas.txt`: aviso de copyright e licença das fontes em uso (OFL 1.1, cláusula 2), que a casca junta
 *   no `licencas.txt` do build.
 *
 * Uso (da raiz): `npm run fontbake` (ou `npm run fontbake -- ui`). Aceita TTF/OTF/WOFF direto e WOFF2 convertido aqui
 * mesmo (só no build). O msdfgen é binário nativo: o SHA do PNG pode mudar entre máquinas.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FontFile, FontRole } from '@boboforces/ui';
import { codepointsForRole, codepointsToString } from './charset.ts';
import {
  assertDerivedName,
  FONT_LICENSE,
  LICENSE_FILE_NAME,
  licenseFile,
  licenseSection,
  oflHeader,
  resolveReservedNames,
} from './license.ts';
import { buildFontPack, stringifyFontPack, toFontFile, type BmFontJson } from './pack.ts';
import { decodePngRgba, encodePngRgba, quantizeChannels, stackVertical, type RgbaImage } from './png.ts';
import { cmapCodepoints, fontName, fontVerticalMetrics } from './sfnt.ts';
import { ATLAS, FONT_BUDGET_BYTES, FONT_JSON_GZIP_LEVEL, FONTS, generatorOptions, type FontSpec } from './spec.ts';
import { isWoff2, woff2ToSfnt } from './woff2.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const FONT_DIR = join(ROOT, 'assets-src', 'fonts');
const OUT_DIR = join(FONT_DIR, 'generated');
const OUT_NAME = 'ui-fonts.generated';

type GenerateCallback = (
  error: Error | null,
  textures: { filename: string; texture: Buffer }[],
  font: { filename: string; data: string },
) => void;
type GenerateBMFont = (
  font: Buffer,
  options: Record<string, unknown>,
  callback: GenerateCallback,
  logger: { log(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void },
) => void;

const require = createRequire(import.meta.url);
const generateBMFont = require('msdf-bmfont-xml') as GenerateBMFont;

function findSource(base: string): string {
  for (const ext of ['.ttf', '.otf', '.woff2']) {
    const path = join(FONT_DIR, base + ext);
    if (existsSync(path)) return path;
  }
  throw new Error(`fontbake: fonte ${base} não encontrada em assets-src/fonts/`);
}

function generate(sfnt: Uint8Array, spec: FontSpec, charset: string): Promise<{ png: Buffer; bm: BmFontJson }> {
  const quiet = { log() {}, warn() {}, error: (...a: unknown[]) => console.error(...a) };
  return new Promise((done, failWith) => {
    let settled = false;
    generateBMFont(
      Buffer.from(sfnt),
      generatorOptions(spec, charset),
      (error, textures, font) => {
        if (settled) return;
        settled = true;
        if (error) return failWith(error);
        const first = textures[0];
        if (!first) return failWith(new Error('fontbake: o gerador não devolveu textura'));
        if (textures.length > 1) return failWith(new Error(`fontbake: ${spec.file} não coube em uma página`));
        done({ png: first.texture, bm: JSON.parse(font.data) as BmFontJson });
      },
      quiet,
    );
  });
}

interface Baked {
  readonly file: FontFile;
  readonly image: RgbaImage;
  readonly sourcePath: string;
  readonly sourceBytes: number;
  readonly sourceSha: string;
  readonly reserved: readonly string[];
  readonly licenseSection: string;
}

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function bakeFont(spec: FontSpec, layer: number): Promise<Baked> {
  const sourcePath = findSource(spec.file);
  const bytes = new Uint8Array(readFileSync(sourcePath));
  const sfnt = isWoff2(bytes) ? woff2ToSfnt(bytes) : bytes;

  // Licença antes do trabalho pesado: o nome derivado não pode usar o RFN (name ID 0 e cabeçalho do OFL.txt).
  const oflPath = join(dirname(sourcePath), 'OFL.txt');
  if (!existsSync(oflPath)) throw new Error(`fontbake: falta o OFL.txt ao lado de ${relative(ROOT, sourcePath)}`);
  const oflText = readFileSync(oflPath, 'utf8');
  const copyright = fontName(sfnt, 0);
  const origin = relative(ROOT, sourcePath);
  const reserved = resolveReservedNames(`${copyright}\n${oflHeader(oflText)}`, spec.reservedNames, origin);
  assertDerivedName(spec.name, reserved, origin);

  const covered = cmapCodepoints(sfnt);
  const wanted = codepointsForRole(spec.role);
  const present = wanted.filter((c) => covered.has(c));
  const missing = wanted.filter((c) => !covered.has(c));
  const { png, bm } = await generate(sfnt, spec, codepointsToString(present));
  let image = decodePngRgba(new Uint8Array(png));
  if (image.width !== ATLAS.width || image.height !== ATLAS.height) {
    throw new Error(`fontbake: atlas ${image.width}×${image.height}, esperado ${ATLAS.width}×${ATLAS.height}`);
  }
  if (spec.quantizeBits !== undefined) image = quantizeChannels(image, spec.quantizeBits);
  const version = fontName(sfnt, 5).replace(/^Version\s*/i, '');
  const source = `${fontName(sfnt, 4) || spec.file} ${version}`.trim();
  const metrics = fontVerticalMetrics(sfnt);
  const file = toFontFile(bm, {
    layer,
    name: spec.name,
    version,
    missing,
    capHeightEm: metrics.capHeight,
    xHeightEm: metrics.xHeight,
    license: FONT_LICENSE,
    source,
  });
  return {
    file,
    image,
    sourcePath,
    sourceBytes: bytes.length,
    sourceSha: sha256(bytes),
    reserved,
    licenseSection: licenseSection({ derivedName: spec.name, source, oflText }),
  };
}

const kb = (n: number) => `${(n / 1000).toFixed(1).replace('.', ',')} KB`;

async function bakeUiFonts(): Promise<void> {
  const files = {} as Record<FontRole, FontFile>;
  const images: RgbaImage[] = [];
  const sections: string[] = [];
  for (const [layer, spec] of FONTS.entries()) {
    const baked = await bakeFont(spec, layer);
    const { file } = baked;
    files[spec.role] = file;
    images.push(baked.image);
    sections.push(baked.licenseSection);
    const alone = encodePngRgba(baked.image);
    console.log(
      `${spec.role.padEnd(8)} ${file.name} ← ${file.source ?? '?'} (${relative(FONT_DIR, baked.sourcePath)}, ` +
        `${kb(baked.sourceBytes)}, sha256 ${baked.sourceSha.slice(0, 16)}…): ${spec.size} px, faixa ` +
        `${spec.distanceRange}, ${spec.quantizeBits ?? 8} bits; ${file.glyphs.length / 8} glifos, ` +
        `${file.kerning.length / 3} pares de kerning, ${file.missing.length} ausentes; maiúscula ` +
        `${file.capHeight} px, linha ${file.lineHeight} px (base ${file.base}); RFN ` +
        `${baked.reserved.length ? baked.reserved.map((r) => `"${r}"`).join(', ') : 'nenhum'}; camada sozinha ` +
        `${kb(alone.length)}`,
    );
  }
  const pack = buildFontPack(files, { ...ATLAS, layers: images.length, image: `${OUT_NAME}.png` });
  const png = encodePngRgba(stackVertical(images));
  const json = stringifyFontPack(pack);
  const licenses = licenseFile(sections);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${OUT_NAME}.png`), png);
  writeFileSync(join(OUT_DIR, `${OUT_NAME}.json`), json);
  writeFileSync(join(OUT_DIR, LICENSE_FILE_NAME), licenses);
  const jsonGzip = gzipSync(json, { level: FONT_JSON_GZIP_LEVEL }).length;
  const total = png.length + jsonGzip;
  console.log(
    `atlas ui-fonts ${ATLAS.width}×${ATLAS.height}×${images.length}: PNG ${png.length} B, JSON ${json.length} B ` +
      `(gzip -${FONT_JSON_GZIP_LEVEL} ${jsonGzip} B) → download ${total} B = ${kb(total)} de ${kb(FONT_BUDGET_BYTES)} ` +
      `(${total <= FONT_BUDGET_BYTES ? `folga ${FONT_BUDGET_BYTES - total} B` : `ESTOURO de ${total - FONT_BUDGET_BYTES} B`})`,
  );
  console.log(`sha256 PNG ${sha256(png)}, JSON ${sha256(json)}; ${LICENSE_FILE_NAME} ${licenses.length} B`);
  if (total > FONT_BUDGET_BYTES) {
    throw new Error('fontbake: o atlas passou do teto de 120 KB (reserva medida: HUD em 6 bits)');
  }
}

const only = process.argv[2];
if (only !== undefined && only !== 'ui') {
  throw new Error(`fontbake: argumento ${only} desconhecido (só existe "ui"; as candidatas saíram com a decisão #54)`);
}
await bakeUiFonts();
