import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHeadlessMatch } from '@boboforces/ai';
import {
  builtinBotRef,
  decodeMap,
  decodeModelPack,
  MATCH_RECIPE_FORMAT,
  parseLayerManifest,
  type MatchRecipe,
} from '@boboforces/format';
import { hashToHex } from '@boboforces/shared';
import { WEAPON_CODE } from '@boboforces/sim';
import { parseBlockDefs } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { buildMapNav, buildMapWorld, buildSimMap } from './world.ts';

/**
 * TESTE GOLDEN do M1 (integração): 8 bots (4×4, Normal) no CONSTRUTO DE VERDADE — o `.bfmap` do `mapc`, os blocos do
 * texgen, as props do `.bfmodel` e a navegação do `nav` —, montado pelo MESMO caminho do loading do jogo
 * (`buildMapWorld` → `buildMapNav` → `buildSimMap`), semente 42, 3.600 ticks (1 min a 60 Hz). O hash do estado
 * precisa ser igual em duas execuções e igual ao valor gravado.
 *
 * Histórico: M0 `e3f37a6e` (arena de teste). M1 `bf9caca1` (frente sim-ia: Construto sintético e navegação de teste).
 * M1 integração (03/11/2026): `a15e05de` no Construto real (26 abates, 208 tiros em 1 min). M1 verificação
 * (03/11/2026): `b452f553` (18 abates, 228 tiros) — o mapa mudou: pista de leitura com sebe e fecho na borda, painéis
 * do galpão, contraforte de tijolo do print de densidade e o painel da fachada embutido. Escolhas dos prints, ponto de
 * controle 1 (03/11/2026): `00f01aac` (20 abates, 275 tiros, placar 10×10) — PASSO INTERMEDIÁRIO da #52 sozinha: as 7
 * props do dobro colidem e entram na navegação (`isPlayableProp`) e o barril do dobro de (23,9; 67,4) foi para 23,6
 * (com ele no lugar antigo dá `8578936f`). Ponto de controle 2, FINAL das escolhas (03/11/2026): `cf65a778` (22
 * abates, 359 tiros, placar 13×9), igual com `node --jitless`. Duas causas, medidas em separado: (a) a #53 —
 * bodyHeight/aabbHeight 1,625 e eyeHeight 1,425 mudam a colisão, a visão dos bots e as hitboxes em pé — leva
 * `00f01aac` a `4346c24a` no mesmo mapa; (b) a régua de métricas (`print:altura`, fora da área) tira 9 nós de
 * navegação (7174 → 7165) e o passeio dos bots sorteia `rng.int(0, nav.nodeCount)`, o que leva a `cf65a778`. A hitbox
 * agachada pela pose não entra: os bots Normal do golden não agacham (0 ticks agachados). Correção da revisão
 * (03/11/2026): `372dcaea` (22 abates, 231 tiros, placar 8×14), igual com `--jitless` — a régua foi para o plano
 * z = 78,5 (sem paralaxe) e o fundo dela virou concreto liso: 4 nós a menos fora da área (7165 → 7161), e o passeio
 * sorteia sobre `nodeCount`. Nada dentro da área jogável mudou. Port do boneco do FutBobo, ponto de controle 1
 * (04/11/2026): `079f5850` — PASSO INTERMEDIÁRIO da altura B (#55) sozinha: bodyHeight/aabbHeight 1,75, eyeHeight
 * 1,55 e as 5 aberturas do Construto (seteiras da cabine, janela da guarita e do 1º andar do prédio 1) a 2,0 m; o bobo
 * de caixas e as hitboxes ainda são os da altura A. Nav igual (7161 nós, 25 componentes). Port do boneco do FutBobo,
 * ponto de controle 2 (04/11/2026): `cb50303f` (22 abates, 334 tiros, placar 8×14), igual com `--jitless` — a hitbox
 * passa a ser as 12 OBB por postura × pitch do boneco do FutBobo (`figureHitBoxes`, tabela `9324de80`), com os braços
 * cortados a 0,75 m do eixo no plano e a cabeça agachada/deslizando que só levanta (pitch da cabeça em [0; +0,1]). As
 * duas últimas não mexem neste hash: os bots Normal passam 0 tick agachados e nenhum dos 30 acertos de braço cai fora
 * do corte. O `.bfmap` ganhou só a câmera `print:altura-45` (nav igual). M2, fase 1a das armas (08/11/2026):
 * `81150d3b` (21 abates, 304 tiros, placar 7×14) — o estado ganhou loadout e munição por slot, ADS com tempo e a
 * contagem da rajada, e o recuo do fuzil passou a ter o padrão horizontal fixo (0,12°) com ruído menor (0,15° →
 * 0,08°): a mira dos bots muda e o combate muda junto. Fase 1b (08/11/2026): `28969b8b`, com o MESMO combate
 * (21 abates, 304 tiros, 7×14): só o estado mudou (a granada cozinhando e o pool de projéteis entram no hash). Fase 1d (08/11/2026): `b66afdf7` (24
 * abates, 204 tiros, placar 9×15) — os bots sorteiam a primária pela semente (`botPrimaries`: fuzil, SMG, escopeta, LMG,
 * sniper e foguete; o foguete não gera `shot`, a escopeta gera 8) e a IA usa cada arma (distância, ADS, pistola, faca).
 * Fase 2a (08/11/2026): `b26c3ec1`, com o MESMO combate (24 abates, 204 tiros, 9×15): o estado ganhou assistências,
 * agressores recentes, a contagem e o vencedor do FFA. O spawn pontuado não mudou nenhuma escolha (os pontos de time
 * do Construto já ficam fora da vista dos inimigos). Fase 2b (08/11/2026): `d0ba0eca` (22 abates, 205 tiros, 8×14) —
 * quem morre deixa a caixinha de munição e os bots pegaram 4; nenhum bot precisou do Destravar. Fase 3c (09/11/2026):
 * `c3f257c6` (18 abates, 152 tiros, 5×13, 7 caixinhas) — os bots Normal (N2) agora sabem de onde tomaram dano e
 * correm para a cobertura, e patrulham olhando em volta. Fase 3d (09/11/2026): `856785f5` (17 abates, 134 tiros,
 * 8×9, 8 granadas) — o N2: segura o ângulo, flanqueia, recua com a vida baixa e joga granada em quem se escondeu.
 * Fases 3e e 3f: o mesmo hash (os bots Normal são N2). Fase 3g (09/11/2026): `5ee925a0` (11 abates, 87 tiros, 5×6,
 * 7 granadas) — as personalidades da mistura dos níveis passaram a se ver (Rusher corre e pula, Camper segura um
 * ponto, Estrategista flanqueia mais) e todos dão pulinhos de bobeira; esta semente sorteou um minuto mais parado (a
 * média de 8 sementes é 14,8 abates e 238 tiros, contra 15,4 e 256 sem personalidade), então o piso de tiros caiu de
 * 100 para 60. O hash MUDA, de propósito, quando o mapa, os blocos, as props,
 * a colisão, a navegação, a sim ou a IA mudam: atualize no mesmo commit e diga no CHANGELOG o motivo.
 * Mudança sem querer é bug de determinismo. O CI no Linux confere o mesmo valor.
 */
const GOLDEN_HASH = '5ee925a0';
const GOLDEN_TICKS = 3600;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const asset = (logical: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ROOT, 'assets-src', RUNTIME.files[logical] as string)));
const text = (logical: string): string => new TextDecoder().decode(asset(logical));

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'construto',
  seed: 42,
  match: { timeLimitS: 0 },
  teams: [
    { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
    { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
  ],
};

function loadWorld(id = 'construto') {
  const manifest = parseLayerManifest(JSON.parse(text('textures/blocos16.json')) as unknown);
  const layers = new Map(manifest.layers.map((l, i) => [l.name, i] as const));
  const world = buildMapWorld({
    map: decodeMap(asset(`maps/${id}.bfmap`)),
    blockDefs: parseBlockDefs(JSON.parse(text('blocks/blocks.json')) as unknown),
    blockLayer: (name) => layers.get(name),
    models: decodeModelPack(asset('models/modelos.bfmodel')).models,
  });
  return { world, map: buildSimMap(world, buildMapNav(world)) };
}

interface GoldenRun {
  hash: string;
  kills: number;
  shots: number;
  /** M2 (fase 2b): caixinhas pegas e Destravar dos bots (só para a mensagem). */
  boxes: number;
  unstucks: number;
  /** M2 (fase 3d): granadas que os bots jogaram. */
  grenades: number;
  teamScore: number[];
  missing: number;
}

function runGolden(): GoldenRun {
  let kills = 0;
  let shots = 0;
  let boxes = 0;
  let unstucks = 0;
  let grenades = 0;
  const { world, map } = loadWorld();
  const match = createHeadlessMatch({
    recipe,
    map,
    humans: 0,
    onEvents: (events) => {
      for (const ev of events) {
        if (ev.type === 'kill') kills++;
        else if (ev.type === 'shot') shots++;
        else if (ev.type === 'pickup' && ev.action === 'take') boxes++;
        else if (ev.type === 'unstuck') unstucks++;
        else if (ev.type === 'projectile' && ev.action === 'launch' && ev.weapon === WEAPON_CODE.grenade) grenades++;
      }
    },
  });
  match.run(GOLDEN_TICKS);
  const hash = hashToHex(match.sim.stateHash());
  const teamScore = Array.from(match.sim.view().match.teamScore);
  match.dispose();
  const missing = world.missingBlocks.length + world.missingModels.length;
  return { hash, kills, shots, boxes, unstucks, grenades, teamScore, missing };
}

describe('golden do M1: 8 bots no Construto real (.bfmap + nav), semente 42, 3.600 ticks', () => {
  it('hash estável entre execuções e igual ao gravado', () => {
    const a = runGolden();
    const b = runGolden();
    expect(a.missing).toBe(0);
    expect(b.hash).toBe(a.hash);
    // A partida precisa ter combate de verdade, senão o golden não prova nada.
    expect(a.shots).toBeGreaterThan(60);
    expect(a.kills).toBeGreaterThan(4);
    expect(a.teamScore[0]! + a.teamScore[1]!).toBe(a.kills);
    const summary = `abates ${a.kills}, tiros ${a.shots}, placar ${a.teamScore.slice(0, 2).join('×')}`;
    expect(a.hash, `${summary}, caixinhas ${a.boxes}, destravar ${a.unstucks}, granadas ${a.grenades}`).toBe(
      GOLDEN_HASH,
    );
  }, 120_000);
});

/**
 * M3 (fase 2e): o golden do Bobo Zombies. 4 bots Normal de apoio (sem humanos) contra as ondas no Construto, pool de
 * 24, semente 42, até 2 min. Confere o hash, a onda alcançada e que houve combate (abates de zumbi e quedas). O hash
 * MUDA quando a sim, a IA (dos bots ou dos zumbis) ou o mapa mudam: atualize no mesmo commit e diga o motivo no
 * CHANGELOG. Gravado na fase 2e (10/11/2026): `eea4c1c8` (os bots caem na onda 3: 32 abates, 7 quedas; a IA ainda não
 * sabe reviver nem fugir das ondas, fase 3). Fase 3a (10/11/2026): `5a793de3` (zumbis ignoram os caídos; os bots recuam
 * atirando e levantam os colegas: aos 7.200 ticks ainda na onda 3, com 34 abates e 3 quedas). Fase 3b: `9ee60f97` (o
 * sorteio dos especiais consome o RNG dos zumbis desde a onda 1: onda 3, 34 abates, 5 quedas). Fase 3c: `4f85c2b3`
 * (os zumbis seguem o flow field e o preso aperta Destravar: onda 3, 33 abates, 5 quedas). Fase 3d: `deecab03` (os
 * pontos de conserto da onda entram no hash; a partida é a mesma: o Construto não tem janelas). Fase 4c: `e8669653`
 * (as vantagens entram no hash; a partida é a mesma).
 */
const GOLDEN_ZOMBIES_HASH = 'e8669653';
const GOLDEN_ZOMBIES_TICKS = 7200;

function runZombiesGolden(): { hash: string; wave: number; kills: number; downs: number; phase: string } {
  const { map } = loadWorld();
  let kills = 0;
  let downs = 0;
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'zombies',
      map: 'construto',
      seed: 42,
      teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 4 }] }],
    },
    map,
    humans: 0,
    zombies: 24,
    onEvents: (events) => {
      for (const ev of events) {
        if (ev.type === 'kill') kills++;
        else if (ev.type === 'down' && ev.action === 'down') downs++;
      }
    },
  });
  for (let t = 0; t < GOLDEN_ZOMBIES_TICKS && match.sim.view().match.phase !== 'ended'; t++) match.step();
  const m = match.sim.view().match;
  const out = { hash: hashToHex(match.sim.stateHash()), wave: m.zombieWave, kills, downs, phase: m.phase };
  match.dispose();
  return out;
}

describe('golden do Bobo Zombies (M3, fase 2e): 4 bots de apoio no Construto, semente 42, até 7.200 ticks', () => {
  it('hash estável entre execuções e igual ao gravado; os bots passam de onda', () => {
    const a = runZombiesGolden();
    const b = runZombiesGolden();
    expect(b.hash).toBe(a.hash);
    expect(a.wave).toBeGreaterThanOrEqual(2);
    expect(a.kills).toBeGreaterThan(10);
    expect(a.hash, `onda ${a.wave}, abates ${a.kills}, quedas ${a.downs}, fase ${a.phase}`).toBe(GOLDEN_ZOMBIES_HASH);
  }, 180_000);
});

/**
 * M3 (fase 3e): o golden do Bobo Zombies no Posto Avançado (janelas com barricada e porta paga): 4 bots Normal de
 * apoio, pool de 24, semente 42, até 2 min. Confere o hash, a onda, que os zumbis arrancaram tábuas e que os bots
 * repuseram. Gravado na fase 3e (10/11/2026): `9e25b203` (onda 3, 38 abates, 5 quedas, 51 tábuas arrancadas e 33
 * repostas). Fase 4b: `9524ad53` (o estado da Caixa Misteriosa entra no hash; a partida é a mesma). Fase 4c:
 * `0e0d586b` (as 3 máquinas de vantagem ocupam espaço e fecham nós da navegação: onda 3, 31 abates, 8 quedas, 36
 * tábuas arrancadas e 18 repostas, derrota antes dos 2 min).
 * MUDA com a sim, a IA, o mapa ou as regras das janelas: atualize no mesmo commit e diga o motivo no CHANGELOG.
 */
const GOLDEN_POSTO_HASH = '0e0d586b';

function runPostoGolden(): {
  hash: string;
  wave: number;
  kills: number;
  downs: number;
  tears: number;
  repairs: number;
  phase: string;
} {
  const { map } = loadWorld('posto');
  let kills = 0;
  let downs = 0;
  let tears = 0;
  let repairs = 0;
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'zombies',
      map: 'posto',
      seed: 42,
      teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 4 }] }],
    },
    map,
    humans: 0,
    zombies: 24,
    onEvents: (events) => {
      for (const ev of events) {
        if (ev.type === 'kill') kills++;
        else if (ev.type === 'down' && ev.action === 'down') downs++;
        else if (ev.type === 'barricade' && ev.action === 'repair') repairs++;
        else if (ev.type === 'barricade') tears++;
      }
    },
  });
  for (let t = 0; t < GOLDEN_ZOMBIES_TICKS && match.sim.view().match.phase !== 'ended'; t++) match.step();
  const m = match.sim.view().match;
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    wave: m.zombieWave,
    kills,
    downs,
    tears,
    repairs,
    phase: m.phase,
  };
  match.dispose();
  return out;
}

describe('golden do Bobo Zombies no Posto Avançado (M3, fase 3e): janelas e porta, semente 42, até 7.200 ticks', () => {
  it('hash estável entre execuções e igual ao gravado; tábuas arrancadas e repostas', () => {
    const a = runPostoGolden();
    const b = runPostoGolden();
    expect(b.hash).toBe(a.hash);
    expect(a.wave).toBeGreaterThanOrEqual(2);
    expect(a.kills).toBeGreaterThan(10);
    expect(a.tears).toBeGreaterThan(6);
    expect(a.repairs).toBeGreaterThan(0);
    expect(
      a.hash,
      `onda ${a.wave}, abates ${a.kills}, quedas ${a.downs}, tábuas ${a.tears}/${a.repairs}, fase ${a.phase}`,
    ).toBe(GOLDEN_POSTO_HASH);
  }, 180_000);
});
