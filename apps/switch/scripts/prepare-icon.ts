// `npm run icon -- <png quadrado>` (apps/switch): gera `apps/switch/icon.jpg` (JPEG 256×256) para o HOME e o
// homebrew menu, como o `prepare-icon.mjs` do MMM. O PNG de origem não é alterado nem esticado.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Jimp } from 'jimp';
import { ICON_PATH } from './paths.ts';

const source = process.argv[2];
if (!source) {
  console.error('Use: npm run icon -- <caminho para um PNG quadrado> (ex.: o logotipo em blocos).');
  process.exit(1);
}
const original = await Jimp.read(resolve(source));
if (original.width !== original.height) throw new Error('Use uma imagem quadrada: o ícone não é esticado nem cortado.');
const jpeg = await original.clone().resize({ w: 256, h: 256 }).getBuffer('image/jpeg', { quality: 95 });
const check = await Jimp.read(jpeg);
if (check.width !== 256 || check.height !== 256) throw new Error('ícone com tamanho inválido');
writeFileSync(ICON_PATH, jpeg);
console.log(JSON.stringify({ icone: ICON_PATH, largura: 256, altura: 256, bytes: jpeg.length }));
