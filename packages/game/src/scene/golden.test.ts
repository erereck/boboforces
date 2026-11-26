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
import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import { ENTITY_FLAG, ENTITY_KIND, entityIndex, NULL_ENTITY, WEAPON_CODE, WEAPON_NONE } from '@boboforces/sim';
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
 * 100 para 60. Refino R1 (16/11/2026): `34edbf41` (11 abates, 91 tiros, 4×7, 9 granadas) — atirar andando ficou
 * arcade no perfil Bobo (a mira quase não abre andando, o gatilho corta a corrida). Refino R2: `b36eb8e1` (o campo do
 * arremesso rápido da granada entra no estado e no hash; a partida é a mesma). M10 fase 1c (26/11/2026): os bots sobem
 * escada reta: `293f84c7` (13 abates, 127 tiros, 7×6, 10 caixinhas, 6 granadas) — o seguidor de rota não larga mais a
 * rota no pé dos lances de 3 e 5 m (Prédios de Teste 1 e 3, torre), o passeio às vezes sobe um andar e o prazo dele
 * cresce com a rota. M11 fase 2 (26/11/2026): o passeio que sobe sorteia por lugar (piso plano), não por andar:
 * `0feaeddd` (15 abates, 1 deles um foguete no próprio pé, que não pontua; 122 tiros, 5×9, 5 caixinhas, 6 granadas).
 * O hash MUDA, de propósito, quando o mapa, os blocos, as props,
 * a colisão, a navegação, a sim ou a IA mudam: atualize no mesmo commit e diga no CHANGELOG o motivo.
 * Mudança sem querer é bug de determinismo. O CI no Linux confere o mesmo valor.
 * M11 fase 1 (os poleiros e o poço do Construto, os poleiros da Base Bobo), sobre a IA da fase 2: `f46d8eb9`.
 * M11 fase 1 na integração (as telas da torre com o topo a 11 m, sobre as fases 2 e 4): `1efd48f4`.
 */
const GOLDEN_HASH = '1efd48f4';
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
  /** M11 (fase 2): as mortes sem matador inimigo (o foguete no próprio pé, a queda): não pontuam (`life.ts`). */
  selfKills: number;
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
  let selfKills = 0;
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
        if (ev.type === 'kill') {
          kills++;
          if (ev.killer === NULL_ENTITY || entityIndex(ev.killer) === entityIndex(ev.victim)) selfKills++;
        } else if (ev.type === 'shot') shots++;
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
  return { hash, kills, selfKills, shots, boxes, unstucks, grenades, teamScore, missing };
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
    // M11 (fase 2): o placar conta só o abate de inimigo; o suicídio (o foguete no próprio pé) não pontua.
    expect(a.teamScore[0]! + a.teamScore[1]!).toBe(a.kills - a.selfKills);
    // Revisão da fase 2: o suicídio é raro (o foguete numa cobertura colada); mais de 1 é a IA errando a mira.
    expect(a.selfKills).toBeLessThanOrEqual(1);
    const score = a.teamScore.slice(0, 2).join('×');
    const summary = `abates ${a.kills} (${a.selfKills} sem matador inimigo), tiros ${a.shots}, placar ${score}`;
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
 * (as vantagens entram no hash; a partida é a mesma). Fase 4d: `8feb69fb` (o sorteio dos drops usa o RNG dos zumbis e
 * os drops ajudam: onda 3, 38 abates, 1 queda). Fase 7c: `dd27cd5e` (o bot de apoio não gasta a reserva: onda 3, 37
 * abates, 3 quedas). Refino R1: `b4b81b30` (atirar andando arcade: onda 3, 37 abates, 3 quedas). Refino R2:
 * `edc93590` (o campo do arremesso rápido no hash; a partida é a mesma). M10 fase 1c (26/11/2026): os bots sobem
 * escada reta (e os zumbis no A* de reserva também): `07976714` (onda 3, 43 abates, 7 quedas, ainda jogando nos 2 min).
 * M11 fase 2 (26/11/2026): o passeio que sobe sorteia por lugar (piso plano), não por andar: `17ab056d` (onda 3, 39
 * abates, 7 quedas, ainda jogando nos 2 min).
 * M11 fase 1 (os poleiros e o poço do Construto, os poleiros da Base Bobo), sobre a IA da fase 2: `e247f81d`.
 */
const GOLDEN_ZOMBIES_HASH = 'e247f81d';
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
 * tábuas arrancadas e 18 repostas, derrota antes dos 2 min). Fase 4d: `088bc2cc` (os drops: onda 3, 36 abates, 7
 * quedas, 42 tábuas arrancadas e 24 repostas, derrota antes dos 2 min). Fase 5a: `dcc24861` (a janela é de mão única
 * para os zumbis no flow field: onda 3, 37 abates, 7 quedas, 42/24 tábuas). Fase 7c: `62251b7e` (o bot de apoio não gasta
 * a reserva: onda 4, 47 abates, 5 quedas, 44/23 tábuas, ainda jogando nos 2 min). Refino R1: `d7ff9e30` (atirar
 * andando arcade: onda 3, 33 abates, 7 quedas, 18/6 tábuas, derrota antes dos 2 min). Refino R2: `6c4eaf90` (o campo
 * do arremesso rápido no hash; a partida é a mesma).
 * MUDA com a sim, a IA, o mapa ou as regras das janelas: atualize no mesmo commit e diga o motivo no CHANGELOG.
 */
const GOLDEN_POSTO_HASH = '6c4eaf90';

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

/**
 * M6 (fase 1): o golden do Domination: 4 contra 4 bots Normal no Construto (os 3 pontos do mapa), semente 42, até
 * 3 min. Confere que os bots jogam o objetivo (os dois times capturam pontos e marcam), e o hash entre execuções.
 * Gravado na fase 1 (19/11/2026): `97f2f078` (capturas 2/3, o time 1 fecha 200 a 101). M10 fase 1c (26/11/2026): os
 * bots sobem escada reta e o passeio às vezes sobe: `b68b0dee` (capturas 1/2, o time 1 fecha 200 a 151). M10: a
 * vantagem do time 0 no Domination (26/11/2026): `5ceddb7e` (capturas 1/1, placar 123×174 nos 3 min, sem fechar) — a
 * vantagem do time 0 era ruído de 8 sementes, mas o defensor de ponto saía do controlador global (`controller % 3`, o
 * 5 contra 5 dava 1 defensor ao time 0 e 2 ao time 1, que vencia 57% no Porto): agora é o terço de cada time, pela
 * ordem dentro dele (`markPointDefenders`). No 4 contra 4 o número de defensores não muda (1 por time); muda QUAL bot
 * do time 0 defende (o 2º, antes o 3º). M11 fase 1 (26/11/2026): os poleiros e o poço do Construto: `f723261d`
 * (capturas 1/2, o time 1 fecha 200 a 161).
 * MUDA com a sim, a IA, o mapa ou as regras dos pontos: atualize no mesmo commit e diga o motivo no CHANGELOG.
 */
const GOLDEN_DOMINATION_HASH = 'f723261d';
const GOLDEN_DOMINATION_TICKS = 10_800;

function runDominationGolden(): { hash: string; captures: number[]; score: number[]; owned: number[]; phase: string } {
  const { map } = loadWorld();
  const captures = [0, 0];
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.domination',
      map: 'construto',
      seed: 42,
      match: { timeLimitS: 0, scoreLimit: 200 },
      teams: [
        { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
      ],
    },
    map,
    humans: 0,
    onEvents: (events) => {
      for (const ev of events) if (ev.type === 'point' && ev.action === 'captured') captures[ev.team]!++;
    },
  });
  for (let t = 0; t < GOLDEN_DOMINATION_TICKS && match.sim.view().match.phase !== 'ended'; t++) match.step();
  const v = match.sim.view();
  const cp = v.controlPoints!;
  const owned = [0, 0];
  for (let i = 0; i < cp.count; i++) if (cp.owner[i]! >= 0) owned[cp.owner[i]!]!++;
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    captures,
    score: [v.match.teamScore[0]!, v.match.teamScore[1]!],
    owned,
    phase: v.match.phase,
  };
  match.dispose();
  return out;
}

describe('golden do Domination (M6, fase 1): 4 contra 4 bots no Construto, semente 42, até 10.800 ticks', () => {
  it('os bots jogam o objetivo: os dois times capturam e marcam; hash estável', () => {
    const a = runDominationGolden();
    const b = runDominationGolden();
    expect(b.hash).toBe(a.hash);
    const msg = `capturas ${a.captures.join('/')}, placar ${a.score.join('×')}, pontos ${a.owned.join('/')}, fase ${a.phase}`;
    console.log(`[domination] ${msg} · hash ${a.hash}`);
    expect(a.captures[0], msg).toBeGreaterThan(0);
    expect(a.captures[1], msg).toBeGreaterThan(0);
    expect(a.score[0]! + a.score[1]!, msg).toBeGreaterThan(60);
    expect(a.hash, msg).toBe(GOLDEN_DOMINATION_HASH);
  }, 240_000);
});

/**
 * M6 (fase 2): o Gun Game e o Infection com bots no Construto, semente 42. O Gun Game: 8 bots Normal na escada de 7
 * armas (a faca por último), até alguém fechar ou 4 min. O Infection: 8 bots sobreviventes, 3 min. Conferem que os bots
 * jogam (sobem a escada; os infectados pegam gente) e o hash entre execuções. Gravados na fase 2 (19/11/2026): Gun Game
 * `6595bdd9` (um bot fecha a escada em 3.707 ticks), Infection `ffb3e5cb` (os 8 infectados em 7.648 ticks). M10 fase
 * 1c (26/11/2026): os bots sobem escada reta e o passeio às vezes sobe: Gun Game `5f4a962e` (um bot fecha em 7.741
 * ticks; níveis 7, 6, 6, 5, 5, 5, 4, 4), Infection `274706cf` (os 8 infectados em 5.966 ticks). M11 fase 2
 * (26/11/2026): o passeio que sobe sorteia por lugar (piso plano), não por andar: Gun Game `d6c258a7` (um bot fecha em
 * 5.569 ticks; níveis 7, 6, 6, 4, 4, 4, 3, 2), Infection `b3d188b9` (os 8 infectados em 6.363 ticks).
 * MUDAM com a sim, a IA, o mapa ou as regras dos modos: atualize no mesmo commit e diga o motivo no CHANGELOG.
 * M11 fase 1 (os poleiros e o poço do Construto, os poleiros da Base Bobo), sobre a IA da fase 2: Gun Game `1d861d5b`,
 * Infection `8d512cae`. M11 fase 1 na integração (as telas da torre com o topo a 11 m, sobre as fases 2 e 4):
 * Infection `0f81a8cf`.
 */
const GOLDEN_GUNGAME_HASH = '1d861d5b';
const GOLDEN_INFECTION_HASH = '0f81a8cf';
const GUN_GAME_LADDER = ['rifle', 'smg', 'shotgun', 'lmg', 'sniper', 'pistol', 'knife'];

function runPartyGolden(kind: 'gunGame' | 'infection'): {
  hash: string;
  levels: number[];
  teams: number[];
  phase: string;
  winnerTeam: number;
  ticks: number;
} {
  const { map } = loadWorld();
  const normal = builtinBotRef('normal');
  const recipe: MatchRecipe =
    kind === 'gunGame'
      ? {
          format: MATCH_RECIPE_FORMAT,
          mode: 'warfare.ffa',
          map: 'construto',
          seed: 42,
          match: { timeLimitS: 0, scoreLimit: 0 },
          weapons: { ladder: GUN_GAME_LADDER, ammo: 'infiniteReserve' },
          teams: [{ bots: [{ ref: normal, count: 8 }] }],
        }
      : {
          format: MATCH_RECIPE_FORMAT,
          mode: 'warfare.tdm',
          map: 'construto',
          seed: 42,
          match: { timeLimitS: 180, scoreLimit: 0 },
          infection: {},
          teams: [{ bots: [{ ref: normal, count: 8 }] }, { bots: [] }],
        };
  const match = createHeadlessMatch({ recipe, map, humans: 0 });
  const limit = kind === 'gunGame' ? 14_400 : 10_900;
  let t = 0;
  for (; t < limit && match.sim.view().match.phase !== 'ended'; t++) match.step();
  const v = match.sim.view();
  const levels: number[] = [];
  const teams = [0, 0];
  for (let e = 0; e < v.count; e++) {
    if (v.alive[e] !== 1) continue;
    levels.push(v.points[e]!);
    if (v.team[e]! < 2) teams[v.team[e]!]!++;
  }
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    levels: levels.sort((a, b) => b - a),
    teams,
    phase: v.match.phase,
    winnerTeam: v.match.winnerTeam,
    ticks: t,
  };
  match.dispose();
  return out;
}

describe('goldens dos modos de festa (M6, fase 2): Gun Game e Infection com bots no Construto', () => {
  it('Gun Game: os bots sobem a escada e alguém fecha; hash estável', () => {
    const a = runPartyGolden('gunGame');
    const b = runPartyGolden('gunGame');
    expect(b.hash).toBe(a.hash);
    const msg = `níveis ${a.levels.join(',')}, fase ${a.phase} em ${a.ticks} ticks`;
    console.log(`[gungame] ${msg} · hash ${a.hash}`);
    expect(a.levels[0]!, msg).toBeGreaterThanOrEqual(3);
    expect(a.hash, msg).toBe(GOLDEN_GUNGAME_HASH);
  }, 240_000);

  it('Infection: os infectados pegam gente; a partida acaba (ninguém sobrou ou o tempo); hash estável', () => {
    const a = runPartyGolden('infection');
    const b = runPartyGolden('infection');
    expect(b.hash).toBe(a.hash);
    const msg = `sobreviventes ${a.teams[0]}, infectados ${a.teams[1]}, fase ${a.phase} (vencedor ${a.winnerTeam}) em ${a.ticks} ticks`;
    console.log(`[infection] ${msg} · hash ${a.hash}`);
    expect(a.teams[1]!, msg).toBeGreaterThanOrEqual(2);
    expect(a.phase, msg).toBe('ended');
    expect(a.hash, msg).toBe(GOLDEN_INFECTION_HASH);
  }, 240_000);
});

/**
 * M6 (fase 3): o Juggernaut (Rodízio) com 8 bots Normal no Construto, semente 42, 3 min. Confere que os bots caçam o
 * Jugg (ele troca de mãos várias vezes), que alguém pontua como Jugg e o hash entre execuções. Gravado na fase 3
 * (19/11/2026): `f7c0ff3a` (4 Juggs em 3 min; o melhor fez 71 pontos). M10 fase 1c (26/11/2026): os bots sobem escada
 * reta e o passeio às vezes sobe: `d8fc313c` (4 Juggs em 3 min; pontos 96, 69 e 14). M11 fase 2 (26/11/2026): o
 * passeio que sobe sorteia por lugar (piso plano), não por andar: `3cc792a8` (4 Juggs em 3 min; pontos 70, 54, 46 e
 * 8). MUDA com a sim, a IA, o mapa ou as regras.
 * M11 fase 1 (os poleiros e o poço do Construto, os poleiros da Base Bobo), sobre a IA da fase 2: `d7a3fab5`.
 */
const GOLDEN_JUGGERNAUT_HASH = 'd7a3fab5';

function runJuggernautGolden(): { hash: string; points: number[]; holders: number; ticks: number; phase: string } {
  const { map } = loadWorld();
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'juggernaut',
    map: 'construto',
    seed: 42,
    match: { timeLimitS: 180, scoreLimit: 150 },
    teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 8 }] }, { bots: [] }],
  };
  const match = createHeadlessMatch({ recipe, map, humans: 0 });
  let holders = 0;
  let last = -1;
  let t = 0;
  for (; t < 10_900 && match.sim.view().match.phase !== 'ended'; t++) {
    match.step();
    const v = match.sim.view();
    let jugg = -1;
    for (let e = 0; e < v.count && jugg < 0; e++) if (v.alive[e] === 1 && v.team[e] === 1) jugg = e;
    if (jugg >= 0 && jugg !== last) {
      holders++;
      last = jugg;
    }
  }
  const v = match.sim.view();
  const points: number[] = [];
  for (let e = 0; e < v.count; e++) if (v.alive[e] === 1) points.push(v.points[e]!);
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    points: points.sort((a, b) => b - a),
    holders,
    ticks: t,
    phase: v.match.phase,
  };
  match.dispose();
  return out;
}

describe('golden do Juggernaut (M6, fase 3) com bots no Construto', () => {
  it('os bots caçam o Jugg (ele troca de mãos) e alguém pontua; hash estável', () => {
    const a = runJuggernautGolden();
    const b = runJuggernautGolden();
    expect(b.hash).toBe(a.hash);
    const msg = `pontos ${a.points.join(',')}, ${a.holders} Juggs, fase ${a.phase} em ${a.ticks} ticks`;
    console.log(`[juggernaut] ${msg} · hash ${a.hash}`);
    expect(a.holders, msg).toBeGreaterThanOrEqual(4);
    expect(a.points[0]!, msg).toBeGreaterThanOrEqual(10);
    expect(a.phase, msg).toBe('ended');
    expect(a.hash, msg).toBe(GOLDEN_JUGGERNAUT_HASH);
  }, 240_000);
});

/**
 * M6 (fase 4): o Bobo Chaos (Times 4 contra 4 com a Roleta) com 8 bots Normal no Construto, semente 42, 3 min. Confere
 * que a Roleta troca 1 modificador por minuto, que os bots jogam com eles (abates) e o hash entre execuções. Gravado na
 * fase 4b (19/11/2026), com os 12 modificadores: `c1b4cd36` (Lua, Pressa e Cabeção; sai a Lua e entra a Festa; sai o
 * Cabeção e entram os Invisíveis; 25 × 31). Regravado no M9 (fase 1, 20/11/2026), com os 15 da Roleta (o Mini, os
 * Bots gigantes e o Ricochete entraram): `02b92b79` (Gravidade pesada, Só na cabeça e Festa; sai a pesada e entra o
 * Ricochete; sai a Festa e entram os Bots gigantes; 27 × 18). Na revisão da fase 1 a mira da IA no gigante embaixo de
 * teto passou a ficar abaixo dele: `ae3a48fd` (as mesmas trocas; 24 × 25, com morte súbita até o tick 10.832, onde
 * sai o Ricochete e entra a pesada). Na fase 1b o gigante encolhe debaixo de teto baixo (a escala de cada corpo sai
 * no fim do tick e as hitboxes usam a do tick anterior): `566e5be9` (as mesmas trocas; 24 × 22 nos 10.800 ticks, sem
 * morte súbita). M10 fase 1c (26/11/2026): os bots sobem escada reta e o passeio às vezes sobe: `bcdb24cc` (as mesmas
 * trocas e mais uma na prorrogação; 28 × 27 em 10.885 ticks). M11 fase 2 (26/11/2026): o passeio que sobe sorteia
 * por lugar (piso plano), não por andar: `30c55d7b` (as mesmas trocas, sem prorrogação; 27 × 25 em 10.800 ticks). MUDA
 * com a sim, a IA, o mapa ou os modificadores.
 * M11 fase 1 (os poleiros e o poço do Construto, os poleiros da Base Bobo), sobre a IA da fase 2: `1bf255d5`.
 * M11 fase 1 na integração (as telas da torre com o topo a 11 m, sobre as fases 2 e 4): `a43b1644`.
 */
const GOLDEN_CHAOS_HASH = 'a43b1644';

function runChaosGolden(): { hash: string; masks: number[]; score: number[]; ticks: number } {
  const { map } = loadWorld();
  const normal = builtinBotRef('normal');
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'construto',
    seed: 42,
    match: { timeLimitS: 180, scoreLimit: 0 },
    chaos: {},
    teams: [{ bots: [{ ref: normal, count: 4 }] }, { bots: [{ ref: normal, count: 4 }] }],
  };
  const match = createHeadlessMatch({ recipe, map, humans: 0 });
  const masks: number[] = [];
  let t = 0;
  for (; t < 10_900 && match.sim.view().match.phase !== 'ended'; t++) {
    match.step();
    const m = match.sim.view().chaos!.masks[0]!;
    if (masks[masks.length - 1] !== m) masks.push(m);
  }
  const v = match.sim.view();
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    masks,
    score: [v.match.teamScore[0]!, v.match.teamScore[1]!],
    ticks: t,
  };
  match.dispose();
  return out;
}

describe('golden do Bobo Chaos (M6, fase 4) com bots no Construto', () => {
  it('a Roleta troca 1 por minuto e os bots jogam; hash estável', () => {
    const a = runChaosGolden();
    const b = runChaosGolden();
    expect(b.hash).toBe(a.hash);
    const msg = `máscaras ${a.masks.map((m) => m.toString(2)).join(' → ')}, placar ${a.score.join('×')} em ${a.ticks} ticks`;
    console.log(`[chaos] ${msg} · hash ${a.hash}`);
    // A largada (3 ligados) e as trocas dos minutos 1 e 2 (o fim é no minuto 3).
    expect(a.masks.length, msg).toBeGreaterThanOrEqual(3);
    expect(a.score[0]! + a.score[1]!, msg).toBeGreaterThan(10);
    expect(a.hash, msg).toBe(GOLDEN_CHAOS_HASH);
  }, 240_000);
});

/**
 * M6 (fase 5): o Bobo Paintball (4 contra 4, 1 acerto derruba, renasce em 1 s) com 8 bots Normal no Construto, semente
 * 42, até 50 abates ou 3 min. Confere que os bots acertam a bola de tinta (adiantando o voo e a queda), que o placar
 * anda e o hash entre execuções. Gravado na fase 5 (19/11/2026): `855196e7` (43 × 35 em 3 min, com o balde). M10 fase
 * 1c (26/11/2026): os bots sobem escada reta e o passeio às vezes sobe: `eb58a2e1` (32 × 42 em 3 min). M11 fase 2
 * (26/11/2026): o passeio que sobe sorteia por lugar (piso plano), não por andar: `1417c604` (33 × 39 em 3 min). MUDA
 * com a sim, a IA, o mapa ou as armas de tinta.
 * M11 fase 1 (os poleiros e o poço do Construto, os poleiros da Base Bobo), sobre a IA da fase 2: `ff749be7`.
 * M11 fase 1 na integração (as telas da torre com o topo a 11 m, sobre as fases 2 e 4): `cdeef769`.
 */
const GOLDEN_PAINTBALL_HASH = 'cdeef769';

function runPaintballGolden(): { hash: string; score: number[]; ticks: number; phase: string } {
  const { map } = loadWorld();
  const normal = builtinBotRef('normal');
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'paintball',
    map: 'construto',
    seed: 42,
    match: { timeLimitS: 180, scoreLimit: 50 },
    players: { respawnS: 1 },
    weapons: { ammo: 'infiniteReserve' },
    paintball: {},
    teams: [{ bots: [{ ref: normal, count: 4 }] }, { bots: [{ ref: normal, count: 4 }] }],
  };
  const match = createHeadlessMatch({ recipe, map, humans: 0 });
  let t = 0;
  for (; t < 10_900 && match.sim.view().match.phase !== 'ended'; t++) match.step();
  const v = match.sim.view();
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    score: [v.match.teamScore[0]!, v.match.teamScore[1]!],
    ticks: t,
    phase: v.match.phase,
  };
  match.dispose();
  return out;
}

describe('golden do Bobo Paintball (M6, fase 5) com bots no Construto', () => {
  it('os bots acertam a tinta e o placar anda; hash estável', () => {
    const a = runPaintballGolden();
    const b = runPaintballGolden();
    expect(b.hash).toBe(a.hash);
    const msg = `placar ${a.score.join('×')}, fase ${a.phase} em ${a.ticks} ticks`;
    console.log(`[paintball] ${msg} · hash ${a.hash}`);
    expect(a.score[0]! + a.score[1]!, msg).toBeGreaterThan(20);
    expect(a.phase, msg).toBe('ended');
    expect(a.hash, msg).toBe(GOLDEN_PAINTBALL_HASH);
  }, 240_000);
});

/**
 * M6 (fase 6a): o Bobo Zombies Fortress no Posto Avançado com 4 bots Normal de apoio, semente 42, até 7.200 ticks.
 * Confere que os zumbis vão no gerador (a vida dele cai) e o hash entre execuções. Gravado na fase 6a (19/11/2026):
 * `cfb8db3d` (os zumbis pelo campo até o gerador; onda 3, o gerador cai para 2.541 e a partida acaba). MUDA com a sim, a
 * IA, o mapa ou o gerador.
 */
const GOLDEN_FORTRESS_HASH = 'cfb8db3d';

function runFortressGolden(): { hash: string; wave: number; hp: number; low: number; phase: string } {
  const { map } = loadWorld('posto');
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'zombies',
      map: 'posto',
      seed: 42,
      zombies: { variant: 'fortress' },
      teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 4 }] }],
    },
    map,
    humans: 0,
    zombies: 24,
  });
  let low = Infinity;
  for (let t = 0; t < GOLDEN_ZOMBIES_TICKS && match.sim.view().match.phase !== 'ended'; t++) {
    match.step();
    low = Math.min(low, match.sim.view().fortress!.hp[0]!);
  }
  const v = match.sim.view();
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    wave: v.match.zombieWave,
    hp: Math.round(v.fortress!.hp[0]!),
    low: Math.round(low),
    phase: v.match.phase,
  };
  match.dispose();
  return out;
}

describe('golden do Bobo Zombies Fortress (M6, fase 6a) no Posto Avançado', () => {
  it('os zumbis atacam o gerador; hash estável', () => {
    const a = runFortressGolden();
    const b = runFortressGolden();
    expect(b.hash).toBe(a.hash);
    const msg = `onda ${a.wave}, gerador ${a.hp} (o mínimo ${a.low}), fase ${a.phase}`;
    console.log(`[fortress] ${msg} · hash ${a.hash}`);
    expect(a.low, msg).toBeLessThan(4000);
    expect(a.wave, msg).toBeGreaterThanOrEqual(2);
    expect(a.hash, msg).toBe(GOLDEN_FORTRESS_HASH);
  }, 240_000);
});

/**
 * M11 (fase 3): o Bobo Zombies Fortress na Fazenda à noite (o mapa do card da Fortaleza desde o M11) com 4 bots Normal
 * de apoio, semente 42, até o fim da Curta (10 ondas; teto de 15 min de jogo). Confere que os zumbis vão no gerador da
 * sala, que a partida acaba e o hash entre execuções (as quedas e os levantados vão na mensagem). Gravado na fase 3 do
 * M11 (26/11/2026): `02c04767` (onda 5; o gerador cai para 1.011; 11 quedas, 2 levantadas pelo colega; os 4 bots caem
 * e a partida acaba em 13.441 ticks, 224 s). M11 fase 2 (o passeio que sobe sorteia por lugar): `dad48f9e` (onda 5;
 * o gerador cai para 2.616; 11 quedas, 4 levantadas; a partida acaba em 11.390 ticks). MUDA com a sim, a IA, a Fazenda
 * ou o gerador.
 * M11 fase 2, revisão (o lugar precisa de 2 colunas em X e em Z e de nós dentro da área jogável): `30d56a36`.
 */
const GOLDEN_FORTRESS_FARM_HASH = '30d56a36';
const GOLDEN_FORTRESS_FARM_TICKS = 60 * 60 * 15;

function runFortressFarmGolden(): {
  hash: string;
  wave: number;
  hp: number;
  low: number;
  downs: number;
  revives: number;
  phase: string;
  winner: number;
  ticks: number;
} {
  const { map } = loadWorld('farm');
  let downs = 0;
  let revives = 0;
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'zombies',
      map: 'farm',
      seed: 42,
      zombies: { variant: 'fortress' },
      teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 4 }] }],
    },
    map,
    humans: 0,
    zombies: 24,
    onEvents: (events) => {
      for (const ev of events) {
        if (ev.type === 'down' && ev.action === 'down') downs++;
        else if (ev.type === 'down' && ev.action === 'revive') revives++;
      }
    },
  });
  let low = Infinity;
  let t = 0;
  for (; t < GOLDEN_FORTRESS_FARM_TICKS && match.sim.view().match.phase !== 'ended'; t++) {
    match.step();
    low = Math.min(low, match.sim.view().fortress!.hp[0]!);
  }
  const v = match.sim.view();
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    wave: v.match.zombieWave,
    hp: Math.round(v.fortress!.hp[0]!),
    low: Math.round(low),
    downs,
    revives,
    phase: v.match.phase,
    winner: v.match.winnerTeam,
    ticks: t,
  };
  match.dispose();
  return out;
}

describe('golden do Bobo Zombies Fortress (M11, fase 3) na Fazenda à noite', () => {
  it('os zumbis atacam o gerador da sala e a partida vai até o fim; hash estável', () => {
    const a = runFortressFarmGolden();
    const b = runFortressFarmGolden();
    expect(b.hash).toBe(a.hash);
    const msg =
      `onda ${a.wave}, gerador ${a.hp} (o mínimo ${a.low}), ${a.downs} caídos e ${a.revives} levantados, ` +
      `fase ${a.phase} (vencedor ${a.winner}) em ${a.ticks} ticks`;
    console.log(`[fortress fazenda] ${msg} · hash ${a.hash}`);
    expect(a.phase, msg).toBe('ended');
    expect(a.low, msg).toBeLessThan(4000);
    expect(a.wave, msg).toBeGreaterThanOrEqual(2);
    expect(a.hash, msg).toBe(GOLDEN_FORTRESS_FARM_HASH);
  }, 240_000);
});

/**
 * M6 (fase 6b): a Horda armada na Base Abandonada: 4 bots Normal de apoio contra a horda de 12 bots Normal (o time 1),
 * semente 42, até 7.200 ticks. Confere que a horda entra (o apoio abate soldados) e o hash entre
 * execuções. Gravado na fase 6b (19/11/2026): `0bc0e8ca` (o apoio derruba 4 dos 5 soldados da 1ª onda, 2 em jogo por vez). M10
 * fase 1c (26/11/2026): os bots sobem escada reta e o passeio às vezes sobe: `72bfc919` (o apoio abate 4 soldados da
 * 1ª onda e a partida acaba). MUDA com a sim, a IA ou o mapa.
 */
const GOLDEN_HORDE_HASH = '72bfc919';

function runHordeGolden(): { hash: string; wave: number; kills: number; downs: number; phase: string } {
  const { map } = loadWorld('base');
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'zombies',
      map: 'base',
      seed: 42,
      zombies: { variant: 'armed' },
      teams: [
        { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 12 }] },
      ],
    },
    map,
    humans: 0,
  });
  let downs = 0;
  for (let t = 0; t < GOLDEN_ZOMBIES_TICKS && match.sim.view().match.phase !== 'ended'; t++) {
    match.step();
    const v = match.sim.view();
    for (let i = 0; i < v.count; i++) if (v.team[i] === 0 && (v.flags[i]! & ENTITY_FLAG.downed) !== 0) downs++;
  }
  const v = match.sim.view();
  let kills = 0;
  for (let i = 0; i < v.count; i++)
    if (v.alive[i] === 1 && v.team[i] === 0 && v.kind[i] === ENTITY_KIND.bobo) kills += v.kills[i]!;
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    wave: v.match.zombieWave,
    kills,
    downs,
    phase: v.match.phase,
  };
  match.dispose();
  return out;
}

describe('golden do Bobo Zombies Horda armada (M6, fase 6b) na Base Abandonada', () => {
  it('a horda de soldados entra e o apoio troca tiro; hash estável', () => {
    const a = runHordeGolden();
    const b = runHordeGolden();
    expect(b.hash).toBe(a.hash);
    const msg = `onda ${a.wave}, abates do apoio ${a.kills}, ticks caídos ${a.downs}, fase ${a.phase}`;
    console.log(`[horda] ${msg} · hash ${a.hash}`);
    expect(a.kills, msg).toBeGreaterThan(0);
    expect(a.wave, msg).toBeGreaterThanOrEqual(1);
    expect(a.hash, msg).toBe(GOLDEN_HORDE_HASH);
  }, 240_000);
});

/**
 * M7 (fase 0): o Juggernaut Fixo (as rodadas) com 4 bots Normal no Construto, semente 42, até 4 rodadas de 3 min.
 * Confere que cada bot é o Jugg numa rodada (pela ordem), que a partida acaba com um vencedor e o hash entre execuções.
 * Gravado na fase 0 (19/11/2026): `9074d33b` (pontos 105, 180, 180 e 109, com o desempate pelos abates; 36.227 ticks). M10
 * fase 1c (26/11/2026): os bots sobem escada reta e o passeio às vezes sobe: `727af431` (pontos 128, 151, 180 e 180;
 * 40.091 ticks). M11 fase 2 (26/11/2026): o passeio que sobe sorteia por lugar (piso plano), não por andar:
 * `a685af0d` (pontos 180, 142, 180 e 172; 42.188 ticks). MUDA com a sim, a IA, o mapa ou as regras.
 * M11 fase 1 (os poleiros e o poço do Construto, os poleiros da Base Bobo), sobre a IA da fase 2: `2572d1aa`.
 */
const GOLDEN_JUGG_FIXED_HASH = '2572d1aa';

function runJuggFixedGolden(): {
  hash: string;
  holders: number[];
  points: number[];
  ticks: number;
  phase: string;
  winner: number;
} {
  const { map } = loadWorld();
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'juggernaut',
    map: 'construto',
    seed: 42,
    match: { timeLimitS: 0, scoreLimit: 0 },
    juggernaut: { variant: 'fixed' },
    teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 4 }] }, { bots: [] }],
  };
  const match = createHeadlessMatch({ recipe, map, humans: 0 });
  const holders: number[] = [];
  let t = 0;
  for (; t < 50_000 && match.sim.view().match.phase !== 'ended'; t++) {
    match.step();
    const v = match.sim.view();
    for (let e = 0; e < v.count; e++) {
      if (v.alive[e] === 1 && v.team[e] === 1 && holders[holders.length - 1] !== e) holders.push(e);
    }
  }
  const v = match.sim.view();
  const points: number[] = [];
  for (let e = 0; e < v.count; e++) if (v.alive[e] === 1) points.push(v.points[e]!);
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    holders,
    points,
    ticks: t,
    phase: v.match.phase,
    winner: v.match.winnerEntity,
  };
  match.dispose();
  return out;
}

describe('golden do Juggernaut Fixo (M7, fase 0) com bots no Construto', () => {
  it('cada bot é o Jugg numa rodada, pela ordem, e a partida acaba; hash estável', () => {
    const a = runJuggFixedGolden();
    const b = runJuggFixedGolden();
    expect(b.hash).toBe(a.hash);
    const msg = `Juggs ${a.holders.join(',')}, pontos ${a.points.join(',')}, fase ${a.phase} em ${a.ticks} ticks`;
    console.log(`[jugg fixo] ${msg} · hash ${a.hash}`);
    expect(a.holders, msg).toEqual([0, 1, 2, 3]);
    expect(a.phase, msg).toBe('ended');
    // Dois aguentaram as rodadas (180 pontos): o desempate pelos abates dá um vencedor.
    expect(a.winner, msg).not.toBe(NULL_ENTITY);
    expect(a.hash, msg).toBe(GOLDEN_JUGG_FIXED_HASH);
  }, 240_000);
});

/**
 * M7 (fase 1): o TDM 4 contra 4 na Base Bobo (o mapa do BoboStrike), semente 42, 2 min. Confere que os bots andam pelas
 * rotas e brigam no mapa novo (abates dos dois lados) e o hash entre execuções. Gravado na fase 1 (19/11/2026):
 * `e3158452` (17 × 18). M10 fase 1c (26/11/2026): o "chegou" do passeio é no mesmo andar e o prazo do passeio cresce
 * com a rota: `3a5f0053` (18 × 24). M11 fase 1 (26/11/2026): os poleiros da Base Bobo (as pilhas de 1 e 1,5 m viraram de
 * 2 m e o jipe do hangar andou 0,5 m): `b61757db` (15 × 24). MUDA com a sim, a IA ou o mapa.
 */
const GOLDEN_AIRBASE_HASH = 'b61757db';

function runAirbaseGolden(): { hash: string; score: [number, number] } {
  const { map } = loadWorld('airbase');
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'airbase',
      seed: 42,
      match: { timeLimitS: 120, scoreLimit: 0 },
      teams: [
        { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
      ],
    },
    map,
    humans: 0,
  });
  for (let t = 0; t < 120 * 60 + 5 && match.sim.view().match.phase !== 'ended'; t++) match.step();
  const v = match.sim.view();
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    score: [v.match.teamScore[0]!, v.match.teamScore[1]!] as [number, number],
  };
  match.dispose();
  return out;
}

describe('golden do TDM na Base Bobo (M7, fase 1)', () => {
  it('os bots brigam no mapa novo; hash estável', () => {
    const a = runAirbaseGolden();
    const b = runAirbaseGolden();
    expect(b.hash).toBe(a.hash);
    const msg = `placar ${a.score.join('×')}`;
    console.log(`[airbase] ${msg} · hash ${a.hash}`);
    expect(Math.min(a.score[0], a.score[1]), msg).toBeGreaterThan(0);
    expect(a.hash, msg).toBe(GOLDEN_AIRBASE_HASH);
  }, 240_000);
});

/**
 * M7 (fase 3): o BoboStrike 5 contra 5 de bots Normal na Base Bobo, semente 42, a partida inteira. Confere que os bots
 * jogam o objetivo (plantam a Boom Box), que a partida acaba nas rodadas e o hash entre execuções. Gravado na fase 3
 * (19/11/2026): `9bf9f851` (12 rodadas, 6 × 6, 6 plantas). M11 fase 1 (26/11/2026): os poleiros da Base Bobo:
 * `6fd11dc0` (12 rodadas, 6 × 6, 4 plantas). MUDA com a sim, a IA ou o mapa.
 */
const GOLDEN_STRIKE_HASH = '6fd11dc0';

function runStrikeGolden(): { hash: string; rounds: number; wins: string; plants: number; phase: string } {
  const { map } = loadWorld('airbase');
  const normal = builtinBotRef('normal');
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'strike',
      map: 'airbase',
      seed: 42,
      teams: [{ bots: [{ ref: normal, count: 5 }] }, { bots: [{ ref: normal, count: 5 }] }],
    },
    map,
    humans: 0,
  });
  let plants = 0;
  let planted = false;
  for (let t = 0; t < 40 * 60 * 60 && match.sim.view().match.phase !== 'ended'; t++) {
    match.step();
    const now = match.sim.view().strike!.data[0] === 2;
    if (now && !planted) plants++;
    planted = now;
  }
  const v = match.sim.view();
  const r = v.rounds!.data;
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    rounds: r[0]!,
    wins: `${r[3]}×${r[4]}`,
    plants,
    phase: v.match.phase,
  };
  match.dispose();
  return out;
}

describe('golden do BoboStrike (M7, fase 3) com bots na Base Bobo', () => {
  it('os bots plantam e a partida acaba nas rodadas; hash estável', () => {
    const a = runStrikeGolden();
    const b = runStrikeGolden();
    expect(b.hash).toBe(a.hash);
    const msg = `${a.rounds} rodadas, ${a.wins}, ${a.plants} plantas, fase ${a.phase}`;
    console.log(`[strike] ${msg} · hash ${a.hash}`);
    expect(a.plants, msg).toBeGreaterThan(0);
    expect(a.phase, msg).toBe('ended');
    expect(a.hash, msg).toBe(GOLDEN_STRIKE_HASH);
  }, 240_000);
});

/**
 * M7 (fase 7): o Bobo Royale solo com 24 bots Normal na Ilha Tropical, semente 42, a partida inteira. Confere que os
 * bots looteiam (a maioria acaba com uma primária), que a partida acaba com um vencedor e o hash entre execuções.
 * Gravado na fase 7 (19/11/2026): `38d57bd4` (100 s, 22 com primária). M10 fase 1c (26/11/2026): os bots sobem escada
 * reta (o seguidor de rota é o mesmo do loot e da zona) e o passeio às vezes sobe: `5d105b0b` (81 s, 22 com primária).
 * MUDA com a sim, a IA ou o mapa.
 */
const GOLDEN_ROYALE_HASH = '5d105b0b';

function runRoyaleGolden(): { hash: string; seconds: number; winner: number; armed: number; phase: string } {
  const { map } = loadWorld('island');
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'royale.mini',
      map: 'island',
      seed: 42,
      royale: { squad: 'solo' },
      teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 24 }] }],
    },
    map,
    humans: 0,
  });
  let armedMax = 0;
  let t = 0;
  for (; t < 12 * 60 * 60 && match.sim.view().match.phase !== 'ended'; t++) {
    match.step();
    if (t % 60 === 0) {
      const v = match.sim.view();
      let armed = 0;
      for (let e = 0; e < v.count; e++) if (v.loadout[e * WEAPON_SLOT_COUNT] !== WEAPON_NONE) armed++;
      armedMax = Math.max(armedMax, armed);
    }
  }
  const v = match.sim.view();
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    seconds: Math.round(t / 60),
    winner: v.match.winnerTeam,
    armed: armedMax,
    phase: v.match.phase,
  };
  match.dispose();
  return out;
}

describe('golden do Bobo Royale (M7, fase 7) com bots na Ilha Tropical', () => {
  it('os bots looteiam e a partida acaba com um vencedor; hash estável', () => {
    const a = runRoyaleGolden();
    const b = runRoyaleGolden();
    expect(b.hash).toBe(a.hash);
    const msg = `${a.seconds} s, vencedor ${a.winner}, ${a.armed} com primária no máximo, fase ${a.phase}`;
    console.log(`[royale] ${msg} · hash ${a.hash}`);
    expect(a.armed, msg).toBeGreaterThanOrEqual(12);
    expect(a.phase, msg).toBe('ended');
    expect(a.winner, msg).toBeGreaterThanOrEqual(0);
    expect(a.hash, msg).toBe(GOLDEN_ROYALE_HASH);
  }, 240_000);
});

/**
 * M11 (fase 5): o Bobo Royale Grande solo com 48 bots Normal no Arquipélago (o mapa de ~400 m, a zona de 6 fases),
 * semente 42, a partida inteira, no molde do golden do Royale: a maioria looteia, a partida acaba com um vencedor e o
 * hash é o mesmo entre execuções. Gravado na fase 5 do M11 (26/11/2026): `64065dca` (140 s, 45 com primária). MUDA
 * com a sim, a IA ou o mapa.
 */
const GOLDEN_ROYALE_GRANDE_HASH = '64065dca';

function runRoyaleGrandeGolden(squad: 'solo' | 'duo'): {
  hash: string;
  seconds: number;
  winner: number;
  armed: number;
  phase: string;
  squadsLeft: number;
} {
  const { map } = loadWorld('archipelago');
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'royale.grande',
      map: 'archipelago',
      seed: 42,
      royale: { squad },
      teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 48 }] }],
    },
    map,
    humans: 0,
  });
  let armedMax = 0;
  let t = 0;
  for (; t < 16 * 60 * 60 && match.sim.view().match.phase !== 'ended'; t++) {
    match.step();
    if (t % 60 === 0) {
      const v = match.sim.view();
      let armed = 0;
      for (let e = 0; e < v.count; e++) if (v.loadout[e * WEAPON_SLOT_COUNT] !== WEAPON_NONE) armed++;
      armedMax = Math.max(armedMax, armed);
    }
  }
  const v = match.sim.view();
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    seconds: Math.round(t / 60),
    winner: v.match.winnerTeam,
    armed: armedMax,
    phase: v.match.phase,
    squadsLeft: v.royale!.data[3]!,
  };
  match.dispose();
  return out;
}

describe('golden do Bobo Royale Grande (M11, fase 5) com bots no Arquipélago', () => {
  it('48 bots looteiam e a partida acaba com um vencedor; hash estável', () => {
    const a = runRoyaleGrandeGolden('solo');
    const b = runRoyaleGrandeGolden('solo');
    expect(b.hash).toBe(a.hash);
    const msg = `${a.seconds} s, vencedor ${a.winner}, ${a.armed} com primária no máximo, fase ${a.phase}`;
    console.log(`[royale grande] ${msg} · hash ${a.hash}`);
    expect(a.armed, msg).toBeGreaterThanOrEqual(24);
    expect(a.phase, msg).toBe('ended');
    expect(a.winner, msg).toBeGreaterThanOrEqual(0);
    expect(a.hash, msg).toBe(GOLDEN_ROYALE_GRANDE_HASH);
  }, 240_000);

  it('em duplas (24 esquadrões, o caído e o reviver), a partida acaba com um esquadrão vencedor', () => {
    const r = runRoyaleGrandeGolden('duo');
    const msg = `${r.seconds} s, vencedor ${r.winner}, ${r.squadsLeft} esquadrão de pé, fase ${r.phase}`;
    console.log(`[royale grande duplas] ${msg}`);
    expect(r.phase, msg).toBe('ended');
    expect(r.winner, msg).toBeGreaterThanOrEqual(0);
    expect(r.winner, msg).toBeLessThan(24);
    expect(r.squadsLeft, msg).toBe(1);
  }, 240_000);
});

/**
 * M8 (fase 8): o TDM 4 contra 4 de bots Normal no Construto com o modificador Arcade, semente 42, 2 min. Os bots não
 * fazem bunny hop nem wall jump (a marca de quadro de jogador), mas andam e pulam no perfil Arcade (o pulo duplo, o
 * deslize, o tiro correndo). Confere que houve luta e o hash entre execuções. Gravado no fechamento do M8 (20/11/2026):
 * `3e7df5b3` (15 × 18). M10 fase 1c (26/11/2026): os bots sobem escada reta e o passeio às vezes sobe: `030ef885`
 * (16 × 18). M11 fase 2 (26/11/2026): o passeio que sobe sorteia por lugar (piso plano), não por andar: `83c6e9fc`
 * (15 × 21).
 * MUDA com a sim, a IA, o mapa ou o perfil Arcade.
 * M11 fase 1 (os poleiros e o poço do Construto, os poleiros da Base Bobo), sobre a IA da fase 2: `7e341112`.
 * M11 fase 1 na integração (as telas da torre com o topo a 11 m, sobre as fases 2 e 4): `0693e3d1`.
 */
const GOLDEN_ARCADE_HASH = '0693e3d1';

function runArcadeGolden(): { hash: string; score: [number, number] } {
  const { map } = loadWorld();
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'construto',
      seed: 42,
      match: { timeLimitS: 120, scoreLimit: 0 },
      modifiers: ['arcade'],
      teams: [
        { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
      ],
    },
    map,
    humans: 0,
  });
  for (let t = 0; t < 120 * 60 + 5 && match.sim.view().match.phase !== 'ended'; t++) match.step();
  const v = match.sim.view();
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    score: [v.match.teamScore[0]!, v.match.teamScore[1]!] as [number, number],
  };
  match.dispose();
  return out;
}

/**
 * M9 (fase 2): o Bobo Sandbox na eliminação: 4 times de 3 bots Normal no Construto, cada um com a sua vida e as suas
 * armas, semente 42, até acabar (teto de 10 min). Os times 2 e 3 não têm ponto no mapa: nascem na casa que a sim dá a
 * eles (a oeste e a leste, longe das bases do norte e do sul). Confere a casa, que ninguém volta, que a partida acaba
 * com um vencedor e o hash entre execuções. Gravado na fase 2 do M9 (20/11/2026): `35764306` (38 s; o Verde vence
 * com 1 de pé; abatidos 3/3/2/3; a casa dos times 2 e 3 a 39,1 m das bases). M11 fase 1 (26/11/2026): os poleiros e o
 * poço do Construto: `ce51be61` (40 s; o Laranja vence com 2 de pé; abatidos 1/3/3/3; a casa no mesmo lugar). MUDA
 * com a sim, a IA ou o mapa.
 * M11 fase 1 na integração (as telas da torre com o topo a 11 m, sobre as fases 2 e 4): `aca32899`.
 */
const GOLDEN_SANDBOX_HASH = 'aca32899';

function runSandboxGolden(): {
  hash: string;
  seconds: number;
  winner: number;
  killed: number[];
  alive: number[];
  /** A menor distância (m, no plano) de um bot dos times 2 e 3 no tick 0 até um ponto de spawn dos times 0 e 1. */
  homeGap: number;
  phase: string;
} {
  const { map } = loadWorld();
  const normal = (count: number) => [{ ref: builtinBotRef('normal'), count }];
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'sandbox',
      map: 'construto',
      seed: 42,
      sandbox: { objective: 'elimination' },
      match: { timeLimitS: 600 },
      teams: [
        { name: 'Laranja', bots: normal(3) },
        { name: 'Azul', hp: 150, weapons: ['shotgun', 'pistol', 'knife', 'grenade'], bots: normal(3) },
        { name: 'Verde', hp: 75, weapons: ['sniper', 'pistol', 'knife'], bots: normal(3) },
        { name: 'Roxo', hp: 120, weapons: ['smg', 'rifle', 'knife', 'grenade'], bots: normal(3) },
      ],
    },
    map,
    humans: 0,
    onEvents: (events, sim) => {
      for (const ev of events) if (ev.type === 'kill') killed[sim.view().team[ev.victim & 0xffff]!]!++;
    },
  });
  const killed = [0, 0, 0, 0];
  let homeGap = Infinity;
  const v0 = match.sim.view();
  for (let e = 0; e < v0.count; e++) {
    if (v0.team[e]! < 2) continue;
    for (const sp of map.spawns) {
      if (sp.team !== 0 && sp.team !== 1) continue;
      homeGap = Math.min(homeGap, Math.hypot(sp.x - v0.position[e * 3]!, sp.z - v0.position[e * 3 + 2]!));
    }
  }
  let t = 0;
  for (; t < 600 * 60 + 5 && match.sim.view().match.phase !== 'ended'; t++) match.step();
  const v = match.sim.view();
  const alive = [0, 0, 0, 0];
  for (let e = 0; e < v.count; e++) {
    if (v.kind[e] === ENTITY_KIND.bobo && (v.flags[e]! & ENTITY_FLAG.dead) === 0) alive[v.team[e]!]!++;
  }
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    seconds: Math.round(t / 60),
    winner: v.match.winnerTeam,
    killed,
    alive,
    homeGap: Math.round(homeGap * 10) / 10,
    phase: v.match.phase,
  };
  match.dispose();
  return out;
}

describe('golden do Bobo Sandbox (M9, fase 2) com 4 times de bots no Construto', () => {
  it('os times 2 e 3 nascem longe das bases; ninguém volta; acaba com o último time de pé; hash estável', () => {
    const a = runSandboxGolden();
    const b = runSandboxGolden();
    expect(b.hash).toBe(a.hash);
    const msg =
      `${a.seconds} s, vencedor ${a.winner}, abatidos ${a.killed.join('/')}, vivos ${a.alive.join('/')}, ` +
      `casa a ${a.homeGap} m das bases, fase ${a.phase}`;
    console.log(`[sandbox] ${msg} · hash ${a.hash}`);
    expect(a.homeGap, msg).toBeGreaterThan(25);
    expect(a.phase, msg).toBe('ended');
    expect(a.winner, msg).toBeGreaterThanOrEqual(0);
    for (let t = 0; t < 4; t++) {
      expect(a.killed[t], msg).toBeLessThanOrEqual(3);
      expect(a.alive[t]! > 0, msg).toBe(t === a.winner);
    }
    expect(a.hash, msg).toBe(GOLDEN_SANDBOX_HASH);
  }, 240_000);
});

describe('golden do Arcade (M8, fechamento) com bots no Construto', () => {
  it('os bots brigam no perfil Arcade; hash estável', () => {
    const a = runArcadeGolden();
    const b = runArcadeGolden();
    expect(b.hash).toBe(a.hash);
    const msg = `placar ${a.score.join('×')}`;
    console.log(`[arcade] ${msg} · hash ${a.hash}`);
    expect(a.score[0] + a.score[1], msg).toBeGreaterThan(4);
    expect(a.hash, msg).toBe(GOLDEN_ARCADE_HASH);
  }, 240_000);
});

/**
 * M11 (fase 4): as armas no mapa (`weapons.pickups`): o FFA de 8 bots Normal no Porto, semente 42, até alguém chegar a
 * 15 abates (ou 4 min). Confere que todo mundo nasce sem a primária, que os bots buscam e pegam as armas do chão (e as
 * pegam de novo depois da volta de 20 s), que a partida acaba e o hash entre execuções. Gravado na fase 4 (26/11/2026):
 * `9805916d` (195 s, 73 abates, o 1º com 15; 46 armas pegas, 38 depois da volta). Revisão (26/11/2026): `1ec165d3`
 * (152 s, 59 abates, o 1º com 15; 33 armas pegas, 25 depois da volta) — o lança-granadas saiu do canal do ponto A (a
 * casa do time 3 do Sandbox) para a praça do guindaste, e o bot de pistola revida quem atira nele. MUDA com a sim, a
 * IA ou o mapa.
 * Na integração, sobre a IA da fase 2 (o passeio que sobe por lugar): `6df27838` (220 s, 86 abates, 51 armas pegas,
 * 43 depois da volta).
 */
const GOLDEN_PICKUPS_HASH = '6df27838';

interface PickupsGoldenRun {
  hash: string;
  phase: string;
  seconds: number;
  kills: number;
  taken: number;
  /** Pegas de um ponto que já tinha ficado vazio (a arma voltou). */
  again: number;
  /** Primárias na largada (tem de ser 0). */
  armedAtStart: number;
  /** As armas pegas, por código. */
  byWeapon: string;
  winnerKills: number;
}

function runPickupsGolden(): PickupsGoldenRun {
  const { map } = loadWorld('port');
  let kills = 0;
  let taken = 0;
  let again = 0;
  const seen = new Set<number>();
  const byWeapon = new Map<number, number>();
  const match = createHeadlessMatch({
    recipe: {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.ffa',
      map: 'port',
      seed: 42,
      match: { timeLimitS: 240, scoreLimit: 15 },
      weapons: { pickups: true },
      teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 8 }] }],
    },
    map,
    humans: 0,
    onEvents: (events) => {
      for (const ev of events) {
        if (ev.type === 'kill') kills++;
        else if (ev.type === 'pickup' && ev.action === 'take' && ev.kind >= 32 && ev.kind < 64) {
          taken++;
          if (seen.has(ev.index)) again++;
          seen.add(ev.index);
          byWeapon.set(ev.kind - 32, (byWeapon.get(ev.kind - 32) ?? 0) + 1);
        }
      }
    },
  });
  const v0 = match.sim.view();
  let armedAtStart = 0;
  for (let e = 0; e < v0.count; e++) if (v0.loadout[e * WEAPON_SLOT_COUNT] !== WEAPON_NONE) armedAtStart++;
  let t = 0;
  for (; t < 240 * 60 + 5 && match.sim.view().match.phase !== 'ended'; t++) match.step();
  const v = match.sim.view();
  let winnerKills = 0;
  for (let e = 0; e < v.count; e++) winnerKills = Math.max(winnerKills, v.kills[e]!);
  const out: PickupsGoldenRun = {
    hash: hashToHex(match.sim.stateHash()),
    phase: v.match.phase,
    seconds: Math.round(t / 60),
    kills,
    taken,
    again,
    armedAtStart,
    byWeapon: [...byWeapon].map(([c, n]) => `${c}:${n}`).join(' '),
    winnerKills,
  };
  match.dispose();
  return out;
}

describe('golden das armas no mapa (M11, fase 4): FFA de 8 bots no Porto', () => {
  it('ninguém nasce armado; os bots pegam as armas do chão (e de novo depois da volta); a partida acaba; hash estável', () => {
    const a = runPickupsGolden();
    const b = runPickupsGolden();
    expect(b.hash).toBe(a.hash);
    const msg =
      `${a.seconds} s, fase ${a.phase}, abates ${a.kills} (o 1º com ${a.winnerKills}), armas pegas ${a.taken} ` +
      `(${a.again} depois da volta; ${a.byWeapon})`;
    console.log(`[pickups] ${msg} · hash ${a.hash}`);
    expect(a.armedAtStart, msg).toBe(0);
    expect(a.phase, msg).toBe('ended');
    expect(a.taken, msg).toBeGreaterThan(8);
    expect(a.again, msg).toBeGreaterThan(0);
    expect(a.kills, msg).toBeGreaterThan(10);
    expect(a.hash, msg).toBe(GOLDEN_PICKUPS_HASH);
  }, 300_000);
});
