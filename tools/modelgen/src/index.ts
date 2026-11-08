// modelgen: modelos de caixas e low-poly (.bfmodel) + a tira de texturas deles. Frente "skins-modelos".
//
//   npm run modelgen            regenera assets-src/models/generated (só reescreve o que mudou) e a folha de contato
//                               local/m1/modelos.png (privada, fora do git)
//   npm run modelgen -- --check confere se os arquivos estão em dia (CI); não grava nada
//
// Fontes em `assets-src/models/` (weapons.ts, props.ts). Validação: `validateModelPack` do format (ID registrado,
// soquetes das armas, teto de triângulos por tipo, UV dentro da camada, camadas existentes) + paleta mestra nas
// camadas e 6 a 20 caixas por arma. Modelo pronto com ID ainda não registrado fica fora do pacote (só na folha).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { encodePng } from '@boboforces/format';
import { buildModelOutputs, modelSummary } from './generate.ts';
import { MODELS_OUT_DIR, ROOT } from './paths.ts';
import { buildModelsSheet } from './preview.ts';

const check = process.argv.includes('--check');
const started = performance.now();
const { files, build } = buildModelOutputs();
let stale = 0;
let written = 0;
for (const [rel, bytes] of files) {
  const path = join(MODELS_OUT_DIR, rel);
  const same = existsSync(path) && Buffer.compare(readFileSync(path), bytes) === 0;
  if (same) continue;
  if (check) {
    console.error(`desatualizado: ${rel}`);
    stale++;
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  written++;
}

if (check) {
  if (stale > 0) {
    console.error(`modelgen: ${stale} arquivo(s) desatualizado(s). Rode "npm run modelgen".`);
    process.exit(1);
  }
  console.log(`modelgen: ${files.size} arquivo(s) em dia.`);
} else {
  const sheetPath = join(ROOT, 'local', 'm1', 'modelos.png');
  mkdirSync(dirname(sheetPath), { recursive: true });
  writeFileSync(sheetPath, encodePng(buildModelsSheet(build.models, build.pending, build.layers)));
  const ms = Math.round(performance.now() - started);
  const packBytes = files.get('modelos.bfmodel')?.length ?? 0;
  console.log(
    `modelgen: ${written} arquivo(s) gravado(s), ${files.size - written} sem mudança, em ${MODELS_OUT_DIR}\n` +
      build.models.map((m) => `  ${modelSummary(m)}`).join('\n') +
      `\n  pacote ${packBytes} B, ${build.layers.length} camadas` +
      (build.pending.length > 0
        ? `\n  fora do pacote (ID não registrado): ${build.pending.map((m) => m.doc.id).join(', ')}`
        : '') +
      `\n  folha de contato em ${sheetPath} (${ms} ms)`,
  );
}
