/**
 * fontbake: gera o atlas MSDF da UI a partir das fontes OFL de `assets-src/fonts/` (tecnico.md §9 e §15.1).
 *
 * Saída em `assets-src/fonts/generated/`:
 * - `ui-fonts.generated.png`: tira vertical (RGB quando opaca), uma camada de 512×256 por fonte (vira um
 *   `TEXTURE_2D_ARRAY`). A `display` leva só caixa alta (`codepointsForRole`);
 * - `ui-fonts.generated.json`: métricas no formato `boboforces/ui-fonts@1` (lido por `parseFontPack` do `ui`).
 *
 * Uso (da raiz): `npm run fontbake`. Aceita TTF/OTF/WOFF direto e WOFF2 convertido aqui mesmo (só no build). Se
 * existir um `.ttf` com o mesmo nome do `.woff2`, o TTF ganha (é a fonte oficial do google/fonts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { codepointsForRole, codepointsToString } from './charset.ts';
import { buildFontPack, stringifyFontPack, toFontFile, type BmFontJson } from './pack.ts';
import { decodePngRgba, encodePngRgba, stackVertical, type RgbaImage } from './png.ts';
import { cmapCodepoints, fontName } from './sfnt.ts';
import { isWoff2, woff2ToSfnt } from './woff2.ts';
import type { FontFile, FontRole } from '@boboforces/ui';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const FONT_DIR = join(ROOT, 'assets-src', 'fonts');
const OUT_DIR = join(FONT_DIR, 'generated');
const OUT_NAME = 'ui-fonts.generated';

/** Todas as camadas têm o mesmo tamanho (exigência do texture array). */
const ATLAS = { width: 512, height: 256 } as const;

interface FontSpec {
  readonly role: FontRole;
  /** Nome base em `assets-src/fonts/` (tenta `.ttf`, `.otf` e `.woff2`, nessa ordem). */
  readonly file: string;
  /** Tamanho (em) de geração em px do atlas. */
  readonly size: number;
  /** Faixa de distância em px: maior = contorno/sombra possíveis no shader, atlas mais cheio. */
  readonly distanceRange: number;
}

/** Barlow Condensed provisória (PLANO_M0): ExtraBold para títulos e botões, SemiBold para leitura e HUD. */
const FONTS: readonly FontSpec[] = [
  { role: 'display', file: 'BarlowCondensed-ExtraBold', size: 28, distanceRange: 4 },
  { role: 'hud', file: 'BarlowCondensed-SemiBold', size: 24, distanceRange: 4 },
];

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
      {
        outputType: 'json',
        filename: spec.role,
        charset,
        fontSize: spec.size,
        distanceRange: spec.distanceRange,
        fieldType: 'msdf',
        textureSize: [ATLAS.width, ATLAS.height],
        texturePadding: 2,
        smartSize: false,
        pot: true,
      },
      (error, textures, font) => {
        if (settled) return;
        settled = true;
        if (error) return failWith(error);
        const first = textures[0];
        if (!first) return failWith(new Error('fontbake: o gerador não devolveu textura'));
        if (textures.length > 1) return failWith(new Error(`fontbake: ${spec.role} não coube em uma página`));
        done({ png: first.texture, bm: JSON.parse(font.data) as BmFontJson });
      },
      quiet,
    );
  });
}

async function bakeFont(spec: FontSpec, layer: number): Promise<{ file: FontFile; image: RgbaImage; source: string }> {
  const source = findSource(spec.file);
  const bytes = new Uint8Array(readFileSync(source));
  const sfnt = isWoff2(bytes) ? woff2ToSfnt(bytes) : bytes;
  const covered = cmapCodepoints(sfnt);
  const wanted = codepointsForRole(spec.role);
  const present = wanted.filter((c) => covered.has(c));
  const missing = wanted.filter((c) => !covered.has(c));
  const { png, bm } = await generate(sfnt, spec, codepointsToString(present));
  const image = decodePngRgba(new Uint8Array(png));
  if (image.width !== ATLAS.width || image.height !== ATLAS.height) {
    throw new Error(`fontbake: atlas ${image.width}×${image.height}, esperado ${ATLAS.width}×${ATLAS.height}`);
  }
  const version = fontName(sfnt, 5).replace(/^Version\s*/i, '');
  const file = toFontFile(bm, { layer, name: fontName(sfnt, 4) || spec.file, version, missing });
  return { file, image, source };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

async function main(): Promise<void> {
  const files = {} as Record<FontRole, FontFile>;
  const images: RgbaImage[] = [];
  for (const [layer, spec] of FONTS.entries()) {
    const { file, image, source } = await bakeFont(spec, layer);
    files[spec.role] = file;
    images.push(image);
    const missingAscii = file.missing.filter((c) => c < 0x100);
    console.log(
      `${spec.role.padEnd(8)} ${file.name} ${file.version} (${source.slice(FONT_DIR.length + 1)}): ` +
        `${file.glyphs.length / 8} glifos, ${file.kerning.length / 3} pares de kerning, ` +
        `${file.missing.length} códigos ausentes${missingAscii.length ? ` (Latin-1: ${missingAscii.join(',')})` : ''}`,
    );
  }
  const pack = buildFontPack(files, { ...ATLAS, layers: images.length, image: `${OUT_NAME}.png` });
  const png = encodePngRgba(stackVertical(images));
  const json = stringifyFontPack(pack);
  mkdirSync(dirname(join(OUT_DIR, 'x')), { recursive: true });
  writeFileSync(join(OUT_DIR, `${OUT_NAME}.png`), png);
  writeFileSync(join(OUT_DIR, `${OUT_NAME}.json`), json);
  console.log(`atlas  ${ATLAS.width}×${ATLAS.height}×${images.length}: PNG ${kb(png.length)}, JSON ${kb(json.length)}`);
}

await main();
