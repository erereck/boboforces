// Prévia do pintor do boneco do FutBobo (decisão #56; PLANO do porte §B19). Grava em local/skins/ (privado):
//   figura-<id>.png       as 2 camadas a 4× e o nível 1, frente e costas sem time e nos times A e B, de cada look
//   figuras.png           frente e costas dos 12 looks lado a lado (e a frente num time)
//   zumbi-rostos.png      os 8 estilos de rosto de zumbi × as 8 expressões, e o zumbi de frente e de costas
//
//   npm run skingen:figuras   (node tools/skingen/src/figuras.ts)
//
// O gerador antigo (`partes64` e as folhas de rosto do bobo A) saiu no passo 5 do porte: o skingen é só esta prévia e
// não entra no `npm run assets` nem no `assets:check` (a skin é pintada no loading).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '@boboforces/format';
import { buildFiguresSheet, buildLookSheet, buildZombieSheet, PREVIEW_LOOKS } from './figure-preview.ts';
import { ROOT } from './paths.ts';

const started = performance.now();
const dir = join(ROOT, 'local', 'skins');
mkdirSync(dir, { recursive: true });
for (const id of PREVIEW_LOOKS) writeFileSync(join(dir, `figura-${id}.png`), encodePng(buildLookSheet(id)));
writeFileSync(join(dir, 'figuras.png'), encodePng(buildFiguresSheet()));
writeFileSync(join(dir, 'zumbi-rostos.png'), encodePng(buildZombieSheet()));
console.log(
  `skingen (figuras): ${PREVIEW_LOOKS.length + 2} folhas em ${dir} (${Math.round(performance.now() - started)} ms)`,
);
