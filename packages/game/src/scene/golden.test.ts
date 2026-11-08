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
 * do corte. O `.bfmap` ganhou só a câmera `print:altura-45` (nav igual). O hash MUDA, de propósito, quando o mapa, os
 * blocos, as props, a colisão, a navegação, a sim ou a IA mudam: atualize no mesmo commit e diga no CHANGELOG o motivo.
 * Mudança sem querer é bug de determinismo. O CI no Linux confere o mesmo valor.
 */
const GOLDEN_HASH = 'cb50303f';
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

function loadWorld() {
  const manifest = parseLayerManifest(JSON.parse(text('textures/blocos16.json')) as unknown);
  const layers = new Map(manifest.layers.map((l, i) => [l.name, i] as const));
  const world = buildMapWorld({
    map: decodeMap(asset('maps/construto.bfmap')),
    blockDefs: parseBlockDefs(JSON.parse(text('blocks/blocks.json')) as unknown),
    blockLayer: (name) => layers.get(name),
    models: decodeModelPack(asset('models/modelos.bfmodel')).models,
  });
  return { world, map: buildSimMap(world, buildMapNav(world)) };
}

function runGolden(): { hash: string; kills: number; shots: number; teamScore: number[]; missing: number } {
  let kills = 0;
  let shots = 0;
  const { world, map } = loadWorld();
  const match = createHeadlessMatch({
    recipe,
    map,
    humans: 0,
    onEvents: (events) => {
      for (const ev of events) {
        if (ev.type === 'kill') kills++;
        else if (ev.type === 'shot') shots++;
      }
    },
  });
  match.run(GOLDEN_TICKS);
  const hash = hashToHex(match.sim.stateHash());
  const teamScore = Array.from(match.sim.view().match.teamScore);
  match.dispose();
  const missing = world.missingBlocks.length + world.missingModels.length;
  return { hash, kills, shots, teamScore, missing };
}

describe('golden do M1: 8 bots no Construto real (.bfmap + nav), semente 42, 3.600 ticks', () => {
  it('hash estável entre execuções e igual ao gravado', () => {
    const a = runGolden();
    const b = runGolden();
    expect(a.missing).toBe(0);
    expect(b.hash).toBe(a.hash);
    // A partida precisa ter combate de verdade, senão o golden não prova nada.
    expect(a.shots).toBeGreaterThan(100);
    expect(a.kills).toBeGreaterThan(4);
    expect(a.teamScore[0]! + a.teamScore[1]!).toBe(a.kills);
    expect(a.hash).toBe(GOLDEN_HASH);
  }, 120_000);
});
