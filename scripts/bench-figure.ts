// Bancada da animação dos bonecos (#56, PLANO do porte §B6 e §E.9; frente F4). Fora do `npm run check`.
//
//   node scripts/bench-figure.ts               com JIT
//   node scripts/bench-figure.ts --jitless     proxy da CPU do Switch (PERF.md)
//   node scripts/bench-figure.ts --tudo        os dois, um depois do outro
//   --pausa=<s>                                descanso entre os cenários (padrão 2 s)
//
// O script se empacota com o esbuild do repositório num .mjs temporário (pasta temporária do sistema, apagado no fim):
// o `--jitless` desliga o WebAssembly, de que a remoção de tipos do Node precisa. Cada cenário roda num PROCESSO
// PRÓPRIO, com `--expose-gc`: o V8 divide o vetor de feedback entre os closures de um mesmo `createFigureRig`, e o
// notebook estrangula a CPU depois de ~1 s de carga contínua; por isso cada cenário mede várias rodadas curtas e relata
// a melhor e a mediana.
//
// Mede o `createFigureRig` real (begin + pose + weapon + end por quadro) com atores roteirizados em 8 papéis (correr,
// strafe ADAD, agachar andando, atirar, recarregar, ADS parado, zumbi, pulo), com clarão de dano de tempos em tempos.
// Os quadros do roteiro são montados antes (um ActorBuffer por quadro, 240 quadros em anel): o laço medido é só o rig.
// Metas (§D, F4): L0 ≤ 55 µs jitless por bobo; 16 em L0 ≤ 0,9 ms; 64 (só PC) ≤ 3,5 ms; heap estável em 10 mil quadros
// com 64 atores (< 64 KB). Relata também `total_allocated_bytes` por quadro. Não grava nada no repositório.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getHeapStatistics } from 'node:v8';
import {
  createFigureGameTable,
  FIGURE_GRIP,
  FIGURE_MODE,
  FIGURE_STANCE,
  figurePosture,
  type FigureGameTable,
} from '../packages/format/src/index.ts';
import { createFigureRig } from '../packages/render/src/actors/anim/rig.ts';
import { createHarnessFrame, createSyntheticFigureTable } from '../packages/render/src/actors/anim/rig-harness.ts';
import { ACTOR_KIND, ACTOR_POSE, createActorBuffer, type ActorBuffer } from '../packages/render/src/types.ts';

const RIFLE = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.rifle, FIGURE_MODE.base, false);
const RIFLE_SPRINT = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.rifle, FIGURE_MODE.sprint, false);
const RIFLE_CROUCH = figurePosture(FIGURE_STANCE.crouch, FIGURE_GRIP.rifle, FIGURE_MODE.base, false);
const PISTOL_ADS = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.pistol, FIGURE_MODE.ads, false);
const ZOMBIE = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.none, FIGURE_MODE.base, true);
const ROLE_NAMES = ['correr', 'strafe ADAD', 'agachado andando', 'atirar', 'recarregar', 'ADS parado', 'zumbi', 'pulo'];
const ROLES = ROLE_NAMES.length;
/** Quadros distintos do roteiro (4 s a 60 Hz), repetidos em anel. */
const RING = 240;

interface Scenario {
  readonly name: string;
  readonly count: number;
  /** Raio (m) em volta da câmera. */
  readonly ring: number;
  /** figureNearM e figureHalfRate (perfil). */
  readonly nearM: number;
  readonly halfRate: boolean;
  /** Quantos ficam atrás da câmera (fora do frustum: L2). */
  readonly hidden: number;
  /** Papel fixo de todos (−1 = papel = i mod 8). */
  readonly role: number;
}

const SCENARIOS: readonly Scenario[] = [
  ...ROLE_NAMES.map((r, k) => ({
    name: `1 bobo L0: ${r}`,
    count: 1,
    ring: 8,
    nearM: 20,
    halfRate: true,
    hidden: 0,
    role: k,
  })),
  { name: '16 em L0', count: 16, ring: 15, nearM: 20, halfRate: true, hidden: 0, role: -1 },
  { name: '16 Switch (L0, L1 e 6 em L2)', count: 16, ring: 30, nearM: 20, halfRate: true, hidden: 6, role: -1 },
  { name: '64 PC (L0)', count: 64, ring: 30, nearM: 40, halfRate: false, hidden: 0, role: -1 },
];

// --- Processo pai: empacota e roda cada cenário num filho ---
const child = process.argv.find((a) => a.startsWith('--cenario='));
if (child === undefined) {
  const modes: string[][] = process.argv.includes('--tudo')
    ? [[], ['--jitless']]
    : process.argv.includes('--jitless')
      ? [['--jitless']]
      : [[]];
  const pauseArg = process.argv.find((a) => a.startsWith('--pausa='));
  const pauseS = pauseArg ? Number(pauseArg.slice(8)) : 2;
  const { build } = await import('esbuild');
  const bundle = join(tmpdir(), `bench-figure-${process.pid}.mjs`);
  await build({
    entryPoints: [import.meta.filename],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    logLevel: 'error',
  });
  let status = 0;
  try {
    for (const flags of modes) {
      const jitless = flags.includes('--jitless');
      console.log(`bench-figure · Node ${process.version} · ${jitless ? 'jitless' : 'JIT'} · pausa ${pauseS} s`);
      for (const which of [...SCENARIOS.map((_, k) => String(k)), 'heap']) {
        if (pauseS > 0) await new Promise((r) => setTimeout(r, pauseS * 1000));
        const r = spawnSync(process.execPath, [...flags, '--expose-gc', bundle, `--cenario=${which}`], {
          stdio: 'inherit',
        });
        if (r.status !== 0) status = r.status ?? 1;
      }
    }
  } finally {
    rmSync(bundle, { force: true });
  }
  process.exit(status);
}

// --- Processo filho: um cenário ---
const jitless = process.execArgv.includes('--jitless');
const gc = (globalThis as { gc?: () => void }).gc;

function loadTable(): { name: string; table: FigureGameTable } {
  try {
    return { name: 'real', table: createFigureGameTable() };
  } catch (e) {
    return { name: `sintética (a real falhou: ${(e as Error).message})`, table: createSyntheticFigureTable() };
  }
}

/** Escreve o ator i do quadro n (papel `role`), espalhado em `ring` m da câmera, na frente dela (−Z). */
function script(actors: ActorBuffer, i: number, n: number, ring: number, role: number): void {
  const t = n / 60;
  // Num leque de ±1 rad, a distância entre 40% e 100% de `ring`.
  const ang = ((i * 2.399963) % 2) - 1;
  const r = ring * (0.4 + (0.6 * ((i * 7919) % 97)) / 97);
  let vx = 0;
  let vz = 0;
  let posture = RIFLE;
  let pose = 0;
  let recoil = 0;
  let reload = 0;
  let weapon = 0;
  let y = 0;
  if (role === 0) {
    vz = -6.8;
    posture = RIFLE_SPRINT;
    pose = ACTOR_POSE.sprint;
  } else if (role === 1) {
    vx = Math.floor(t / 0.35) % 2 === 0 ? 4.8 : -4.8;
  } else if (role === 2) {
    vz = -2.4;
    posture = RIFLE_CROUCH;
    pose = ACTOR_POSE.crouch;
  } else if (role === 3) {
    pose = n % 6 === 0 ? ACTOR_POSE.firing : 0;
    recoil = Math.exp(-12 * ((n % 6) / 60));
  } else if (role === 4) {
    reload = (t % 2.5) / 2.5;
  } else if (role === 5) {
    posture = PISTOL_ADS;
    pose = ACTOR_POSE.ads;
  } else if (role === 6) {
    posture = ZOMBIE;
    weapon = 255;
    vz = -3;
  } else {
    const k = t % 1.2;
    y = k < 0.63 ? 6.32 * k - 10 * k * k : 0;
    pose = y > 0 ? ACTOR_POSE.airborne : 0;
    vz = -4.8;
  }
  actors.entity[i] = 1000 + i;
  actors.kind[i] = posture === ZOMBIE ? ACTOR_KIND.zombie : ACTOR_KIND.bobo;
  actors.figure[i] = 0;
  actors.position[i * 3] = Math.sin(ang) * r + vx * (t % 1);
  actors.position[i * 3 + 1] = y;
  actors.position[i * 3 + 2] = -Math.cos(ang) * r + vz * (t % 1);
  actors.velocity[i * 3] = vx;
  actors.velocity[i * 3 + 1] = 0;
  actors.velocity[i * 3 + 2] = vz;
  actors.yaw[i] = ang * 0.5 + 0.3 * Math.sin(t + i);
  actors.pitch[i] = 0.5 * Math.sin(t * 0.7 + i);
  actors.posture[i] = posture;
  actors.pose[i] = pose;
  actors.weapon[i] = weapon;
  actors.recoil[i] = recoil;
  actors.reload[i] = reload;
  actors.damageFlash[i] = (n + i * 37) % 180 < 18 ? 1 - ((n + i * 37) % 180) / 18 : 0;
  actors.expression[i] = 0;
  actors.scale[i] = 1;
  actors.localSlot[i] = 255;
}

/** Os `RING` quadros do roteiro, um ActorBuffer por quadro (montados fora da medida). */
function frames(s: Scenario): ActorBuffer[] {
  const list: ActorBuffer[] = [];
  for (let n = 0; n < RING; n++) {
    const a = createActorBuffer(s.count);
    a.count = s.count;
    for (let i = 0; i < s.count; i++) {
      script(a, i, n, s.ring, s.role >= 0 ? s.role : i % ROLES);
      // Os "atrás" vão para z > 0 (fora da vista que olha para −Z).
      if (i < s.hidden) a.position[i * 3 + 2] = 3 + Math.abs(a.position[i * 3 + 2]!);
    }
    list.push(a);
  }
  return list;
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

const which = child.slice('--cenario='.length);
const { name: tableName, table } = loadTable();

if (which === 'heap') {
  // Heap antes e depois de 10 mil quadros com 64 atores (gc forçado nas duas pontas) e bytes alocados por quadro.
  const count = 64;
  const ring = frames({ name: 'heap', count, ring: 30, nearM: 40, halfRate: false, hidden: 0, role: -1 });
  const rig = createFigureRig(count);
  rig.setTable(table);
  rig.setLod(40, false);
  const frame = createHarnessFrame(1, 0, 1.55, 0);
  frame.views.planes[2] = -1;
  frame.views.planes[3] = 0;
  const out = new Float32Array(count * 192);
  const weapon = new Float32Array(16);
  const step = (n: number): void => {
    const actors = ring[n % RING]!;
    rig.begin(frame, actors, n);
    for (let i = 0; i < count; i++) {
      rig.pose(actors, i, out, i * 192, false);
      rig.weapon(weapon, 0);
    }
    rig.end(n);
  };
  // Aquecimento longo: o JIT e o feedback crescem o heap uma vez só (~60 KB com 600 quadros), não por quadro.
  const warm = jitless ? 600 : 4000;
  for (let n = 0; n < warm; n++) step(n);
  gc?.();
  gc?.();
  const before = process.memoryUsage().heapUsed;
  const a0 = getHeapStatistics().total_allocated_bytes;
  const totalArg = process.argv.find((a) => a.startsWith('--quadros='));
  const total = totalArg ? Number(totalArg.slice(10)) : 10000;
  for (let n = warm; n < warm + total; n++) step(n);
  const a1 = getHeapStatistics().total_allocated_bytes;
  gc?.();
  gc?.();
  const after = process.memoryUsage().heapUsed;
  rig.dispose();
  console.log(
    `  heap 64 atores × ${total} quadros: ${(before / 1024).toFixed(1)} → ${(after / 1024).toFixed(1)} KB ` +
      `(Δ ${((after - before) / 1024).toFixed(1)} KB; meta < 64 KB) · ${((a1 - a0) / total).toFixed(0)} B alocados/quadro` +
      (gc ? '' : ' (sem gc forçado)'),
  );
} else {
  const s = SCENARIOS[Number(which)]!;
  const ring = frames(s);
  const rig = createFigureRig(s.count);
  rig.setTable(table);
  rig.setLod(s.nearM, s.halfRate);
  const frame = createHarnessFrame(1, 0, 1.55, 0);
  // Vista olhando para −Z: o meio-espaço z ≤ 0 (os "atrás" ficam em z > 0).
  frame.views.planes[2] = -1;
  frame.views.planes[3] = 0;
  frame.dt = 1 / 60;
  const out = new Float32Array(s.count * 192);
  const weapon = new Float32Array(16);
  let n = 0;
  const step = (): void => {
    const actors = ring[n % RING]!;
    rig.begin(frame, actors, n);
    for (let i = 0; i < s.count; i++) {
      rig.pose(actors, i, out, i * 192, false);
      rig.weapon(weapon, 0);
    }
    rig.end(n);
    n++;
  };
  // Aquecimento (entidades novas, JIT), fora da medida.
  for (let k = 0; k < (jitless ? 240 : 2400); k++) step();
  // Rodadas curtas (~0,1–0,2 s): a melhor é a CPU sem estrangular; a mediana vai junto.
  const perRound = Math.max(jitless ? 20 : 400, Math.round((jitless ? 2400 : 48000) / s.count));
  const rounds = 9;
  const times: number[] = [];
  let bytes = 0;
  for (let r = 0; r < rounds; r++) {
    const a0 = getHeapStatistics().total_allocated_bytes;
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < perRound; k++) step();
    const ns = Number(process.hrtime.bigint() - t0);
    bytes += getHeapStatistics().total_allocated_bytes - a0;
    times.push(ns / perRound / 1e6);
  }
  const best = Math.min(...times);
  const mid = median(times);
  const st = rig.stats;
  rig.dispose();
  console.log(
    `  ${s.name.padEnd(30)} ${best.toFixed(3).padStart(7)} ms/quadro (mediana ${mid.toFixed(3)}) ` +
      `${((best * 1000) / s.count).toFixed(2).padStart(7)} µs/bobo  L0/L1/L2 ${st.l0}/${st.l1}/${st.l2}  ` +
      `${(bytes / rounds / perRound).toFixed(0).padStart(7)} B alocados/quadro` +
      (which === '0' ? `  [tabela ${tableName}]` : ''),
  );
}
