// `npm run build:switch` (raiz) ou `npm run build` (apps/switch): gera `apps/switch/romfs/` (main.js, sourcemap,
// assets e manifest.json). Não empacota: NRO e NSP são só locais (`npm run nro` / `npm run nsp`, README).
import { relative } from 'node:path';
import { buildSwitch } from './bundle.ts';
import { ROMFS_DIR, ROOT_DIR } from './paths.ts';

const minify = process.argv.includes('--minify');
const result = await buildSwitch({ outDir: ROMFS_DIR, minify });
for (const w of result.warnings) console.warn(`aviso do esbuild: ${w}`);
const { manifest } = result;
const kb = (result.mainBytes / 1024).toFixed(0);
console.log(
  `Switch: ${relative(ROOT_DIR, result.mainPath)} (${kb} KB${minify ? ', minificado' : ''}) · ` +
    `${result.assetFiles} asset(s) · BoboForces ${manifest.version} "${manifest.codename}" · ` +
    `commit ${manifest.commit?.slice(0, 7) ?? 'nenhum'}${manifest.dirty ? ' + mudanças locais' : ''}`,
);
