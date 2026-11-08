// mapc: compila assets-src/maps/<id>.ts → assets-src/maps/generated/<id>.bfmap. Frente "mapa-nav".
//
//   npm run mapc            compila todos os mapas (só reescreve o que mudou) e grava a vista de cima em local/m1/
//   npm run mapc -- --check confere se os .bfmap estão em dia (CI)
//
// Validações (tecnico.md §15.3): IDs de bloco e modelo registrados, spawns alcançáveis pela navegação (`buildNavGrid`
// com `BOBO_NAV_METRICS`) e invisíveis para o inimigo, portas de 1,0 m, corredores ≥ 1,0 m, maior linha de visão
// medida ≤ declarada ≤ 50 m, teto de tamanho, câmeras dos prints, rotas do bench e manequins obrigatórios
// (`validateMap` com `requirePrintMarkers`, que também confere os opcionais do boneco do FutBobo). Com erro, o .bfmap
// NÃO é gravado e o processo sai com 1. Avisos não barram: travessia TDM fora de 12–18 s, cobertura longe, "visto sem
// ver" (parede entre o olho e o topo da hitbox em pé, 1,81 m), cobertura rente ao agachado (topo em [0,95; 0,98)) e
// alta abaixo da cabeça (topo em [1,75; 1,81)), rota de câmera atravessando bloco e prop dentro de parede. Medidas no
// relatório: braço armado e corpo no deslize através de barreira (J-M4), com o alcance da tabela de jogo, no visual e
// na hitbox da sim (braço cortado a `ARM_HIT_CUT_M`, decisão 1 da §I do PLANO do porte).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MapScript } from './api.ts';
import { loadBlockTable } from './blocks.ts';
import { compileMap } from './compile.ts';
import { loadModelTable } from './models.ts';
import { MAP_IDS, MAPS_OUT_DIR, MAPS_SOURCE_DIR, ROOT } from './paths.ts';
import { formatReport } from './report.ts';
import { renderTopView } from './topview.ts';

const check = process.argv.includes('--check');
const quiet = process.argv.includes('--quiet');
const blocks = loadBlockTable();
const models = loadModelTable();
let failed = 0;

for (const id of MAP_IDS) {
  const mod = (await import(pathToFileURL(join(MAPS_SOURCE_DIR, `${id}.ts`)).href)) as { default: MapScript };
  const result = compileMap(mod.default, { blocks, models, requirePrintMarkers: true, maxSightLimitM: 50 });
  if (!quiet) console.log(formatReport(result));
  const out = join(MAPS_OUT_DIR, `${id}.bfmap`);
  // A vista de cima sai sempre (com erro também): é o que se olha para consertar o mapa.
  const reviewDir = join(ROOT, 'local', 'm1');
  mkdirSync(reviewDir, { recursive: true });
  writeFileSync(join(reviewDir, `${id}-topo.png`), renderTopView(result));
  if (result.errors.length > 0) {
    console.error(`mapc: ${id} com ${result.errors.length} erro(s); .bfmap não gravado.`);
    failed++;
    continue;
  }
  const same = existsSync(out) && Buffer.compare(readFileSync(out), result.bytes) === 0;
  if (check) {
    if (!same) {
      console.error(`desatualizado: maps/generated/${id}.bfmap (rode "npm run mapc")`);
      failed++;
    }
    continue;
  }
  if (!same) {
    mkdirSync(MAPS_OUT_DIR, { recursive: true });
    writeFileSync(out, result.bytes);
  }
  console.log(`mapc: ${id}.bfmap ${same ? 'sem mudança' : 'gravado'}; vista de cima em local/m1/${id}-topo.png`);
}

if (failed > 0) process.exit(1);
