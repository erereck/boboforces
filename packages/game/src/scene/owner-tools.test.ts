import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  builtinBotRef,
  decodeMap,
  decodeModelPack,
  DEFAULT_SETTINGS,
  MATCH_RECIPE_FORMAT,
  parseLayerManifest,
  type MatchRecipe,
} from '@boboforces/format';
import { createRawInputState, keyIndex, MOUSE_BUTTON, PAD_BUTTON, type RawInputState } from '@boboforces/input';
import type { Platform } from '@boboforces/platform-api';
import {
  BOT_CONTROLLER_BASE,
  createInputFrames,
  createSim,
  entityIndex,
  ENTITY_FLAG,
  ENTITY_KIND,
  isOwnerDormant,
  makeEntityId,
  METRICS,
  MOD,
  navMainComponent,
  OWNER,
  ownerSpotNodes,
  ownerSpotTaken,
  WEAPON_CODE,
  ARSENAL,
  type OwnerCommand,
  type OwnerEvent,
  type Sim,
  type SimEvent,
  type SimView,
} from '@boboforces/sim';
import { buildSyntheticConstruto } from '@boboforces/sim/testing';
import {
  BUTTON,
  createDrawList,
  createMenuNavigation,
  DRAW_FLOATS_PER_COMMAND,
  DRAW_OP,
  layoutTree,
  MIN_TEXT,
  MIN_TOUCH_TARGET,
  moveFocus,
  OPTION,
  parseFontPack,
  resetDrawList,
  t,
  type DrawList,
  type MenuNavigation,
  type MsdfFont,
  type TextContent,
  type UiNode,
} from '@boboforces/ui';
import { parseBlockDefs } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { startGame, type GameHandle } from '../game.ts';
import { createNullRenderer } from '../null-renderer.ts';
import type { OnlineSession } from '../online-api.ts';
import { OWNER_RESERVE, ownerReserveFor, ownerToolsAllowed } from '../owner-reserve.ts';
import { pauseScreen } from '../pause.ts';
import type { SceneBundle, SceneRequest } from '../scene-api.ts';
import { aquariumPauseItems } from './aquarium.ts';
import { controllerNames, PRIMARY_ORDER } from './death.ts';
import { botLookIndices } from './figures.ts';
import { SCENE_MODULE } from './index.ts';
import {
  addReserveNames,
  createOwnerTools,
  drawFrozenMarks,
  OWNER_ACTION,
  OWNER_LIVE_MODIFIERS,
  OWNER_NO_TOOL,
  OWNER_TOOL,
  OWNER_UI,
  ownerDormantCount,
  ownerGroundPoint,
  ownerHidden,
  ownerRayOrigin,
  ownerModsScreen,
  ownerSees,
  ownerSpawnSpot,
  ownerToolsScreen,
  type OwnerTools,
} from './owner-tools.ts';
import { summarizeMatch, createMatchStats } from './result.ts';
import { buildMapNav, buildMapWorld, buildSimMap } from './world.ts';

/**
 * M9 (fase 5): as Ferramentas do Dono no jogo. Primeiro o módulo da página e da ferramenta armada contra uma sim
 * headless de verdade (o raio da câmera, os comandos e as respostas); depois a cena inteira pelo `startGame` (o
 * NullRenderer e uma plataforma de mentira), lendo de volta o texto desenhado pelo atlas real.
 */

/** Os ids das armas no índice do código (M10: as novas nos códigos 27 a 31), como os nomes que o jogo passa. */
const WEAPON_IDS: string[] = [];
for (const w of ARSENAL) WEAPON_IDS[w.code] = w.id;

const normal = builtinBotRef('normal');
const vibe = builtinBotRef('vibe');

function sandboxRecipe(extra: Partial<MatchRecipe> = {}): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'sandbox',
    map: 'test',
    seed: 5,
    sandbox: { objective: 'none' },
    teams: [
      { humans: 1, bots: [{ ref: normal, count: 2 }] },
      { bots: [{ ref: normal, count: 2 }] },
      { bots: [{ ref: normal, count: 1 }], name: 'Os Bobos' },
    ],
    ...extra,
  };
}

/** A receita em outro modo (o bloco do Sandbox só vale nele). */
function withoutSandbox(r: MatchRecipe, mode: MatchRecipe['mode']): MatchRecipe {
  const { sandbox: _sandbox, ...rest } = r;
  return { ...rest, mode };
}

function nav(activated: string | null, delta = 0, back = false): MenuNavigation {
  const n = createMenuNavigation();
  n.activated = activated;
  n.delta = delta;
  n.back = back;
  return n;
}

/** Os botões da árvore (id, o texto, o do valor e se está aceso), na ordem. */
function buttons(node: UiNode, out: { id: string; text: string; value: string; on: boolean }[] = []) {
  const text = (c: TextContent): string => ('literal' in c ? c.literal : t(c.key, c.params));
  if (node.kind === 'button') {
    out.push({
      id: node.id ?? '',
      text: text(node.text),
      value: node.value === undefined ? '' : text(node.value),
      on: node.variant === 'primary',
    });
  }
  if ((node.kind === 'box' || node.kind === 'row' || node.kind === 'column') && node.children) {
    for (const c of node.children) buttons(c, out);
  }
  return out;
}

describe('owner-tools (o módulo, com uma sim headless)', () => {
  const { map } = buildSyntheticConstruto({ nav: true });

  function setup(recipe = sandboxRecipe()) {
    const sim = createSim({ recipe, map, humans: 1, owner: { reserve: 3 } });
    const names: string[] = [];
    for (let c = 0; c < 16; c++) names[c] = c === 0 ? 'P1' : `Bot ${c}`;
    const logs: string[] = [];
    const tools = createOwnerTools({
      recipe,
      command: (cmd) => sim.command(cmd),
      view: () => sim.view(),
      nameOf: (v, i) => names[v.controller[i]!] ?? '?',
      primaries: PRIMARY_ORDER,
      weaponNames: WEAPON_IDS,
      slowAllowed: true,
      log: (line) => logs.push(line),
    });
    const frames = createInputFrames();
    /** Um passo da sim; as respostas do dono vão à ferramenta (como o `onEvents` da cena). */
    const step = (): OwnerEvent[] => {
      sim.step(frames);
      const events: SimEvent[] = [];
      sim.drainEvents(events);
      const out: OwnerEvent[] = [];
      for (const ev of events) {
        if (ev.type !== 'owner') continue;
        tools.onEvent(ev, sim.view());
        out.push({ ...ev });
      }
      return out;
    };
    return { sim, tools, logs, step };
  }

  const at = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));
  /** Câmera 2,5 m acima dos pés do bobo `e`, olhando para baixo (o raio passa pela cabeça dele). */
  function above(tools: OwnerTools, v: SimView, e: number, local: (c: number) => boolean = () => false): void {
    const x = v.position[e * 3]!;
    const y = v.position[e * 3 + 1]!;
    const z = v.position[e * 3 + 2]!;
    tools.apply(v, x, y + 2.5, z, 0, -Math.PI / 2 + 1e-3, -1, local);
  }

  it('a página: as ferramentas com os valores, a câmera lenta, e os 15 modificadores ao vivo (sem o Arcade)', () => {
    const { tools, sim } = setup();
    const list = buttons(tools.build(null));
    // O Voltar compacto no canto, as 3 linhas de opção, Congelar e Tirar, Modificadores e a Câmera lenta.
    expect(list.map((b) => b.id)).toEqual([
      'own-back',
      'own-spawn',
      'own-team',
      'own-weapon',
      'own-freeze',
      'own-remove',
      'own-mods',
      'own-slow',
    ]);
    // O "criar bot" no 1º time, o "trocar de time" no 2º, a 1ª primária e a velocidade normal.
    expect(list.map((b) => b.value)).toEqual(['', 'Laranja', 'Azul', 'rifle', '', '', '', '']);
    expect(list.at(-1)!.text).toBe('Câmera lenta: 1×');
    // Esquerda e direita trocam o valor (a página fica); o 3º time tem nome: aparece o nome.
    expect(tools.action(nav(OWNER_ACTION.team, 1))).toBe('rebuild');
    expect(tools.action(nav(OWNER_ACTION.spawn, -1))).toBe('rebuild');
    expect(tools.action(nav(OWNER_ACTION.weapon, 1))).toBe('rebuild');
    const values = buttons(tools.build(null)).map((b) => b.value);
    // M10: a 2ª primária do radial é o DMR.
    expect(values.slice(1, 4)).toEqual(['Os Bobos', 'Os Bobos', 'rifle.dmr']);
    // A câmera lenta anda 1× → 0,5× → 0,25× → 1× (cada aperto avança).
    expect(tools.slow).toBe(1);
    tools.action(nav(OWNER_ACTION.slow));
    expect(tools.slow).toBe(0.5);
    expect(buttons(tools.build(null)).at(-1)!.text).toBe('Câmera lenta: 0,5×');
    tools.action(nav(OWNER_ACTION.slow));
    expect(tools.slow).toBe(0.25);
    tools.action(nav(OWNER_ACTION.slow));
    expect(tools.slow).toBe(1);
    // A reserva na linha de baixo do título: os 3 dormentes.
    expect(ownerDormantCount(sim.view())).toBe(3);
    // Os modificadores: um botão por modificador (aceso = ligado) e o Voltar, que volta às ferramentas.
    expect(tools.action(nav(OWNER_ACTION.mods))).toBe('rebuild');
    expect(tools.page).toBe('mods');
    const mods = buttons(tools.build(null));
    expect(mods.map((b) => b.id)).toEqual(['own-back', ...OWNER_LIVE_MODIFIERS.map((id) => `own-mod-${id}`)]);
    expect(OWNER_LIVE_MODIFIERS).toHaveLength(15);
    expect(OWNER_LIVE_MODIFIERS).not.toContain('arcade');
    expect(mods.some((b) => b.on)).toBe(false);
    expect(tools.action(nav(null, 0, true))).toBe('rebuild');
    expect(tools.page).toBe('tools');
    // Voltar da página das ferramentas volta à pausa; confirmar numa ferramenta arma e fecha a pausa.
    expect(tools.action(nav(OWNER_ACTION.back))).toBe('back');
    expect(tools.armed).toBe(OWNER_NO_TOOL);
    expect(tools.action(nav(OWNER_ACTION.freeze))).toBe('resume');
    expect(tools.armed).toBe(OWNER_TOOL.freeze);
    tools.cancel();
    expect(tools.armed).toBe(OWNER_NO_TOOL);
    sim.dispose();
  });

  it('"criar bot" pelo raio da câmera: o bot da reserva entra perto do ponto do chão, no time escolhido, e o aviso sai', () => {
    const { sim, tools, step, logs } = setup();
    step();
    const v = sim.view();
    const me = at(sim, 0);
    const x = v.position[me * 3]!;
    const y = v.position[me * 3 + 1]!;
    const z = v.position[me * 3 + 2]!;
    tools.action(nav(OWNER_ACTION.spawn, 1)); // o time 1 (Azul)
    expect(tools.action(nav(OWNER_ACTION.spawn))).toBe('resume');
    // Para o céu: nada vai à sim.
    tools.apply(v, x, y + 1.6, z, 0, Math.PI / 2 - 1e-3, -1, () => false);
    expect(tools.notice).toBe('Mire no chão');
    // Olhando para o chão 3 m à frente (o rumo 0 olha para −Z).
    const pitch = -Math.atan2(1.6, 3);
    tools.apply(v, x, y + 1.6, z, 0, pitch, me, () => false);
    const [ev] = step();
    expect(ev).toMatchObject({ command: 'spawnBot', ok: true });
    const e = entityIndex(ev!.entity);
    expect(v.controller[e]).toBe(BOT_CONTROLLER_BASE + 5);
    expect(v.team[e]).toBe(1);
    expect(isOwnerDormant(v, e)).toBe(false);
    expect(Math.hypot(v.position[e * 3]! - x, v.position[e * 3 + 2]! - (z - 3))).toBeLessThan(8);
    expect(tools.notice).toBe('Bot criado: Bot 9');
    expect(tools.noticeAlpha).toBe(1);
    // A ferramenta continua armada até cancelar; o aviso some sozinho.
    expect(tools.armed).toBe(OWNER_TOOL.spawn);
    tools.update(3);
    expect(tools.notice).toBe('');
    expect(logs).toContain('[partida] dono: spawnBot ok');
    expect(ownerDormantCount(v)).toBe(2);
    sim.dispose();
  });

  it('congelar, trocar de time, dar arma e tirar: no bobo sob a mira; humano e o vazio são recusados', () => {
    const { sim, tools, step } = setup();
    step();
    const v = sim.view();
    const bot = at(sim, BOT_CONTROLLER_BASE + 2);
    const me = at(sim, 0);
    // Nada sob a mira: o raio bate no chão do lado de quem está.
    tools.action(nav(OWNER_ACTION.freeze));
    tools.apply(
      v,
      v.position[bot * 3]! + 3,
      v.position[bot * 3 + 1]! + 2.5,
      v.position[bot * 3 + 2]!,
      0,
      -1.4,
      -1,
      () => false,
    );
    expect(tools.notice).toBe('Mire num bot');
    // O jogador deste aparelho não é alvo (nem chega à sim); o humano de outro aparelho, a sim recusa.
    above(tools, v, me, (c) => c === 0);
    expect(tools.notice).toBe('Só funciona em bots');
    above(tools, v, me);
    expect(step()[0]).toMatchObject({ command: 'freeze', ok: false, reason: 'human' });
    expect(tools.notice).toBe('Só funciona em bots');
    // Congelar e soltar (o mesmo item, pelo estado do bot).
    above(tools, v, bot);
    expect(step()[0]).toMatchObject({ command: 'freeze', ok: true });
    expect(v.owner!.frozen[bot]).toBe(1);
    expect(tools.notice).toBe('Bot 6 congelado');
    above(tools, v, bot);
    step();
    expect(v.owner!.frozen[bot]).toBe(0);
    expect(tools.notice).toBe('Bot 6 solto');
    // Trocar de time: para o 3º (o nome dele no aviso).
    tools.action(nav(OWNER_ACTION.team, 1));
    tools.action(nav(OWNER_ACTION.team));
    above(tools, v, bot);
    expect(step()[0]).toMatchObject({ command: 'setTeam', ok: true });
    expect(v.team[bot]).toBe(2);
    expect(tools.notice).toBe('Bot 6 agora é do time Os Bobos');
    // Dar arma: a sniper.
    const sniper = PRIMARY_ORDER.indexOf(WEAPON_CODE.sniper);
    for (let i = 0; i < sniper; i++) tools.action(nav(OWNER_ACTION.weapon, 1));
    tools.action(nav(OWNER_ACTION.weapon));
    above(tools, v, bot);
    expect(step()[0]).toMatchObject({ command: 'giveWeapon', ok: true });
    expect(v.weapon[bot]).toBe(WEAPON_CODE.sniper);
    expect(tools.notice).toBe('Bot 6 ganhou sniper');
    // Tirar da partida: fica dormente (e some das listas por jogador).
    tools.action(nav(OWNER_ACTION.remove));
    above(tools, v, bot);
    expect(step()[0]).toMatchObject({ command: 'remove', ok: true });
    expect(ownerHidden(v, bot)).toBe(true);
    expect(tools.notice).toBe('Bot 6 saiu da partida');
    // Dormente não é alvo: a sim nem acha (está morto, o raio passa).
    above(tools, v, bot);
    expect(tools.notice).toBe('Mire num bot');
    sim.dispose();
  });

  it('modificadores ao vivo: a página mostra o pedido antes do passo, o par que conflita sai, e a resposta confirma', () => {
    const { sim, tools, step } = setup();
    tools.action(nav(OWNER_ACTION.mods));
    expect(tools.action(nav(`${OWNER_ACTION.modPrefix}mini`))).toBe('rebuild');
    const shown = (id: string): string =>
      buttons(tools.build(null)).find((b) => b.id === `own-mod-${id}`)!.on ? 'Ligado' : 'Desligado';
    // Ainda sem passo (a partida pausada): a página já mostra ligado (aceso).
    expect(shown('mini')).toBe('Ligado');
    expect(sim.view().chaos!.masks[0]! & MOD.mini).toBe(0);
    step();
    expect(sim.view().chaos!.masks[0]! & MOD.mini).toBe(MOD.mini);
    expect(tools.notice).toBe('Mini ligado');
    // Revisão: a resposta pede para refazer a página aberta (uma vez).
    expect([tools.takeChanged(), tools.takeChanged()]).toEqual([true, false]);
    // Os Gigantes conflitam com o Mini: ligar um desliga o outro (na página e na sim).
    tools.action(nav(`${OWNER_ACTION.modPrefix}giantBots`));
    expect([shown('mini'), shown('giantBots')]).toEqual(['Desligado', 'Ligado']);
    step();
    const mask = sim.view().chaos!.masks[0]!;
    expect([mask & MOD.mini, mask & MOD.giantBots]).toEqual([0, MOD.giantBots]);
    tools.action(nav(`${OWNER_ACTION.modPrefix}giantBots`));
    step();
    expect(sim.view().chaos!.masks[0]! & MOD.giantBots).toBe(0);
    expect(tools.notice).toBe('Bots gigantes desligado');
    sim.dispose();
  });

  it('a reserva: 8 no Sandbox (no teto do aparelho), nada fora dele; cada bot da reserva com um nome', () => {
    const r = sandboxRecipe();
    expect(OWNER_RESERVE).toBe(8);
    expect(ownerToolsAllowed(r)).toBe(true);
    expect(ownerReserveFor(r, 1, 24)).toBe(8);
    // 5 bots na receita e teto 10: sobram 5.
    expect(ownerReserveFor(r, 1, 10)).toBe(5);
    expect(ownerReserveFor(r, 1, 3)).toBe(0);
    expect(ownerReserveFor(withoutSandbox(r, 'warfare.tdm'), 1, 24)).toBeNull();
    expect(ownerReserveFor(withoutSandbox(r, 'zombies'), 1, 24)).toBeNull();
    const names: string[] = ['P1'];
    addReserveNames(names, r, 1, 2);
    expect(names[BOT_CONTROLLER_BASE + 5]).toBeDefined();
    expect(names[BOT_CONTROLLER_BASE + 6]).toBeDefined();
    expect(names[BOT_CONTROLLER_BASE + 7]).toBeUndefined();
  });

  it('fase 5b: os bots da reserva têm nomes diferentes, longe dos da receita, e a mesma conta dá os mesmos nomes', () => {
    const r = sandboxRecipe();
    const reserveBase = BOT_CONTROLLER_BASE + 5;
    const withReserve = (recipe: MatchRecipe, n: number): string[] => {
      const names = controllerNames(recipe, 1);
      addReserveNames(names, recipe, 1, n);
      return names;
    };
    const names = withReserve(r, 8);
    const reserve = names.slice(reserveBase, reserveBase + 8);
    expect(reserve).toHaveLength(8);
    // Os 8 diferentes entre si, nenhum "Normal Bob" e nenhum igual a um bot da receita.
    expect(new Set(reserve).size).toBe(8);
    expect(reserve).not.toContain('Normal Bob');
    for (const name of reserve) expect(names.slice(BOT_CONTROLLER_BASE, reserveBase)).not.toContain(name);
    // Nomes bobos do gerador da Oficina ("Sergeant Noodle").
    for (const name of reserve) expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    // A mesma receita dá os mesmos nomes (o host e o amigo online).
    expect(withReserve(r, 8)).toEqual(names);
    // Revisão: um humano com o nome que a reserva sortearia (o da sala, o mesmo nos dois lados): a reserva desvia.
    const human = controllerNames(r, 1);
    human[0] = reserve[2]!;
    addReserveNames(human, r, 1, 8);
    const dodged = human.slice(reserveBase, reserveBase + 8);
    expect(dodged).not.toContain(reserve[2]);
    expect(new Set(dodged).size).toBe(8);
    expect(dodged.slice(0, 2)).toEqual(reserve.slice(0, 2));
    // Os primeiros da reserva não mudam com o tamanho dela; outra semente, outros nomes.
    expect(withReserve(r, 3).slice(reserveBase, reserveBase + 3)).toEqual(reserve.slice(0, 3));
    expect(withReserve({ ...r, seed: 6 }, 8).slice(reserveBase)).not.toEqual(reserve);
    // Os looks saem do nome: a reserva não veste um look só.
    const looks = botLookIndices(names, 12);
    expect(new Set(reserve.map((_, k) => looks[reserveBase + k])).size).toBeGreaterThan(1);
    // Sem reserva, nada muda.
    expect(withReserve(r, 0)).toEqual(controllerNames(r, 1));
  });

  it('o resultado não premia quem está fora (o "Covarde" sem tiro ia para um bot da reserva)', () => {
    const recipe = sandboxRecipe();
    const sim = createSim({ recipe, map, humans: 1, owner: { reserve: 4 } });
    const v = sim.view();
    const st = createMatchStats(v.capacity);
    // Todo mundo em jogo atirou pelo menos uma vez; a reserva não.
    for (let i = 0; i < v.count; i++) if (!isOwnerDormant(v, i)) st.shots[i] = 5 + i;
    const sum = summarizeMatch(st, v, at(sim, 0), false);
    const coward = sum.prizes.find((p) => p.prize === 'coward');
    expect(coward).toBeDefined();
    expect(isOwnerDormant(v, coward!.entity)).toBe(false);
    expect((v.flags[coward!.entity]! & ENTITY_FLAG.dead) === 0).toBe(true);
    sim.dispose();
  });

  it('revisão: o log do replay cheio tem o aviso dele; a recusa da cena (morto) também', () => {
    const recipe = sandboxRecipe();
    const sim = createSim({ recipe, map, humans: 1, owner: { reserve: 1 } });
    let full = true;
    const tools = createOwnerTools({
      recipe,
      command: () => -1,
      view: () => sim.view(),
      nameOf: () => '?',
      primaries: PRIMARY_ORDER,
      weaponNames: WEAPON_IDS,
      slowAllowed: false,
      log: () => {},
      logFull: () => full,
    });
    tools.action(nav(OWNER_ACTION.mods));
    tools.action(nav(`${OWNER_ACTION.modPrefix}mini`));
    expect(tools.notice).toBe('Esta partida chegou ao limite de comandos do dono');
    full = false;
    tools.action(nav(`${OWNER_ACTION.modPrefix}mini`));
    expect(tools.notice).toBe('Calma: comandos demais de uma vez');
    tools.fail('dead');
    expect(tools.notice).toBe('Só com o seu bobo em jogo');
    // Sem resposta da sim, nada a refazer; a resposta marca a página para refazer (uma vez).
    expect(tools.takeChanged()).toBe(false);
    sim.dispose();
  });

  it('revisão: a faixa da ferramenta armada fica acima do limite (a faixa do Aquário) e o rótulo não é refeito à toa', () => {
    const { tools, sim } = setup();
    tools.action(nav(OWNER_ACTION.spawn));
    const list = createDrawList(512);
    const bottomOf = (limit: number): number => {
      resetDrawList(list, 1280, 720);
      tools.draw(
        list,
        FONTS.hud,
        0,
        0,
        1280,
        720,
        13,
        'Mouse esquerdo: aplicar · Mouse direito: cancelar',
        false,
        limit,
      );
      let bottom = 0;
      for (let c = 0; c < list.count; c++) {
        const g = c * DRAW_FLOATS_PER_COMMAND;
        bottom = Math.max(bottom, list.geom[g + 1]! + list.geom[g + 3]!);
      }
      return bottom;
    };
    // Sem limite, a 76% da altura (até ~610 px); com a faixa do Aquário começando em 596, termina antes.
    expect(bottomOf(Number.POSITIVE_INFINITY)).toBeGreaterThan(596);
    expect(bottomOf(596)).toBeLessThanOrEqual(596);
    // O mesmo texto nas duas vezes (o rótulo só muda com a ferramenta ou o valor).
    const glyphs = (): number => {
      resetDrawList(list, 1280, 720);
      tools.draw(list, FONTS.hud, 0, 0, 1280, 720, 13, '', false);
      return list.count;
    };
    expect(glyphs()).toBe(glyphs());
    tools.action(nav(OWNER_ACTION.spawn, 1));
    expect(squash(drawnText(list)).toLowerCase()).toContain('criarbot·laranja');
    glyphs();
    expect(squash(drawnText(list)).toLowerCase()).toContain('criarbot·azul');
    sim.dispose();
  });
});

describe('fase 5b (prints): o lugar do "criar bot" à vista e a plaquinha dos congelados', () => {
  const { map } = buildSyntheticConstruto({ nav: true });
  /**
   * A mureta de 2 m do lado sul do Construto sintético: x 15–19 m, y 0,5–2,5 m, z 54–55 m (o chão fica em y 0,5).
   * Os nós da navegação de teste têm 1 m (centros nos meios-metros: z 53,5 do lado norte, 55,5 do lado sul).
   */
  const WALL = { minX: 15, maxX: 19, top: 2.5, minZ: 54, maxZ: 55 } as const;
  const CHEST = 1.1;

  function setup(reserve = 3) {
    const recipe = sandboxRecipe();
    const sim = createSim({ recipe, map, humans: 1, owner: { reserve } });
    const frames = createInputFrames();
    const step = (): OwnerEvent[] => {
      sim.step(frames);
      const events: SimEvent[] = [];
      sim.drainEvents(events);
      return events.filter((ev): ev is OwnerEvent => ev.type === 'owner').map((ev) => ({ ...ev }));
    };
    return { recipe, sim, step, main: navMainComponent(sim.view().nav!) };
  }
  /** O rumo e a inclinação da câmera em `o` olhando para `p` (o rumo 0 olha para −Z). */
  function aim(o: readonly number[], p: readonly number[]): { yaw: number; pitch: number } {
    const dx = p[0]! - o[0]!;
    const dy = p[1]! - o[1]!;
    const dz = p[2]! - o[2]!;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  }
  /** O nó que a sim escolheria SEM a cena: o livre mais perto do ponto, até 8 m (a conta de antes da fase 5b). */
  function simOnly(v: SimView, main: number, x: number, y: number, z: number): Float64Array {
    const nodes = new Int32Array(OWNER.placeTries);
    const d2 = new Float64Array(OWNER.placeTries);
    const n = ownerSpotNodes(v.nav!, main, v.playArea, x, y, z, OWNER.placeMaxDistM, nodes, d2);
    const out = new Float64Array(3);
    for (let k = 0; k < n; k++) {
      v.nav!.nodePosition(nodes[k]!, out, 0);
      if (!ownerSpotTaken(v, out[0]!, out[1]!, out[2]!)) return out;
    }
    throw new Error('nenhum nó');
  }
  const sees = (v: SimView, o: ArrayLike<number>, p: ArrayLike<number>): boolean =>
    ownerSees(v, o[0]!, o[1]!, o[2]!, p[0]!, p[1]! + CHEST, p[2]!) ||
    ownerSees(v, o[0]!, o[1]!, o[2]!, p[0]!, p[1]! + METRICS.eyeHeight, p[2]!);

  it('a sim põe o bot exatamente no nó que a cena escolheu (à vista, perto do ponto), virado para a câmera', () => {
    const { recipe, sim, step, main } = setup();
    const v = sim.view();
    // A câmera alta ao sul da mureta (como a câmera livre do Aquário), mirando no alto dela, um pouco ao norte do meio.
    const cam = [17.2, 7, 60] as const;
    const target = [17.2, WALL.top, 54.4] as const;
    const { yaw, pitch } = aim(cam, target);
    const ground = new Float64Array(3);
    expect(ownerGroundPoint(v, cam[0], cam[1], cam[2], yaw, pitch, ground)).toBe(true);
    // O raio bate no alto do muro (um chão, para o raio); na navegação de teste o alto dela é um nó (desce dele).
    expect(ground[1]).toBeCloseTo(WALL.top, 5);
    const spot = new Float64Array(3);
    expect(ownerSpawnSpot(v, main, cam[0], cam[1], cam[2], yaw, pitch, spot)).toBeNull();
    expect(Math.hypot(spot[0]! - ground[0]!, spot[1]! - ground[1]!, spot[2]! - ground[2]!)).toBeLessThan(1);
    expect(sees(v, cam, spot)).toBe(true);
    // A conta da sim sozinha começa pelo mesmo nó (o que a cena manda é o primeiro dela).
    expect([...simOnly(v, main, spot[0]!, spot[1]!, spot[2]!)]).toEqual([...spot]);
    // Pela ferramenta: a sim põe o bot exatamente no nó escolhido (o nó a distância 0 é o primeiro dela).
    const tools = createOwnerTools({
      recipe,
      command: (cmd) => sim.command(cmd),
      view: () => sim.view(),
      nameOf: () => 'Bot',
      primaries: PRIMARY_ORDER,
      weaponNames: WEAPON_IDS,
      slowAllowed: true,
      log: () => {},
    });
    tools.action(nav(OWNER_ACTION.spawn));
    tools.apply(v, cam[0], cam[1], cam[2], yaw, pitch, -1, () => false);
    const [ev] = step();
    expect(ev).toMatchObject({ command: 'spawnBot', ok: true });
    const e = entityIndex(ev!.entity);
    expect(
      Math.hypot(v.position[e * 3]! - spot[0]!, v.position[e * 3 + 1]! - spot[1]!, v.position[e * 3 + 2]! - spot[2]!),
    ).toBeLessThan(1e-4);
    // Virado para a câmera (o rumo de quem criou).
    expect(Math.abs(Math.sin(v.yaw[e]!))).toBeLessThan(0.1);
    sim.dispose();
  });

  it('mirando no pé do muro: o bot nasce na frente dele, do lado de quem mira, perto do ponto e à vista', () => {
    const { sim, main } = setup();
    const v = sim.view();
    const cam = [17, 0.5 + METRICS.eyeHeight, 61] as const;
    const target = [17, 0.7, WALL.maxZ] as const;
    const { yaw, pitch } = aim(cam, target);
    const spot = new Float64Array(3);
    expect(ownerSpawnSpot(v, main, cam[0], cam[1], cam[2], yaw, pitch, spot)).toBeNull();
    expect(spot[2]).toBeGreaterThan(WALL.maxZ);
    expect(Math.hypot(spot[0]! - target[0], spot[2]! - target[2])).toBeLessThan(1);
    expect(sees(v, cam, spot)).toBe(true);
    sim.dispose();
  });

  it('o alto do muro da borda (4 m, sem nó por perto): volta pelo raio e cai no chão de dentro, à vista', () => {
    const { sim, main } = setup();
    const v = sim.view();
    // O muro da borda oeste: x 3,5–4 m, até y 4,5 m; a área jogável começa em x 4 (os nós a partir de 4,5).
    const cam = [10, 8, 40] as const;
    const { yaw, pitch } = aim(cam, [3.75, 4.5, 40]);
    const ground = new Float64Array(3);
    expect(ownerGroundPoint(v, cam[0], cam[1], cam[2], yaw, pitch, ground)).toBe(true);
    expect(ground[1]).toBeCloseTo(4.5, 5);
    const spot = new Float64Array(3);
    expect(ownerSpawnSpot(v, main, cam[0], cam[1], cam[2], yaw, pitch, spot)).toBeNull();
    expect(spot[1]).toBeCloseTo(0.5, 5);
    expect(spot[0]).toBeGreaterThan(4);
    expect(spot[0]).toBeLessThan(7);
    expect(sees(v, cam, spot)).toBe(true);
    sim.dispose();
  });

  it('nenhum nó livre à vista (de fora da área, com o muro na frente): recusa sem mandar o comando', () => {
    const { recipe, sim, step, main } = setup();
    const v = sim.view();
    // Do lado de fora do muro da borda, olhando para o chão de fora: os nós da área ficam atrás do muro.
    const cam = [1.5, 0.5 + METRICS.eyeHeight, 40] as const;
    const { yaw, pitch } = aim(cam, [1.5, 0.5, 37]);
    const spot = new Float64Array(3);
    expect(ownerSpawnSpot(v, main, cam[0], cam[1], cam[2], yaw, pitch, spot)).toBe('place');
    const sent: OwnerCommand[] = [];
    const logs: string[] = [];
    const tools = createOwnerTools({
      recipe,
      command: (cmd) => {
        sent.push(cmd);
        return sim.command(cmd);
      },
      view: () => sim.view(),
      nameOf: () => 'Bot',
      primaries: PRIMARY_ORDER,
      weaponNames: WEAPON_IDS,
      slowAllowed: true,
      log: (line) => logs.push(line),
    });
    tools.action(nav(OWNER_ACTION.spawn));
    tools.apply(v, cam[0], cam[1], cam[2], yaw, pitch, -1, () => false);
    expect(sent).toEqual([]);
    expect(tools.notice).toBe('Sem lugar livre perto da mira');
    expect(logs).toContain('[partida] dono: criar bot recusado (place)');
    expect(step()).toEqual([]);
    sim.dispose();
  });

  it('o nó à vista ocupado por um bobo fica de fora: o bot nasce no próximo livre à vista', () => {
    const { sim, step, main } = setup();
    const v = sim.view();
    const cam = [17.2, 7, 60] as const;
    const { yaw, pitch } = aim(cam, [17.2, WALL.top, 54.4]);
    const first = new Float64Array(3);
    expect(ownerSpawnSpot(v, main, cam[0], cam[1], cam[2], yaw, pitch, first)).toBeNull();
    // Um bot da reserva no nó escolhido (o comando da sim, sem a cena), e de novo: outro nó, livre e à vista.
    sim.command({ kind: 'spawnBot', team: 0, x: first[0]!, y: first[1]!, z: first[2]!, yaw: 0 });
    expect(step()[0]).toMatchObject({ ok: true });
    const second = new Float64Array(3);
    expect(ownerSpawnSpot(v, main, cam[0], cam[1], cam[2], yaw, pitch, second)).toBeNull();
    expect(Math.hypot(second[0]! - first[0]!, second[2]! - first[2]!)).toBeGreaterThan(OWNER.placeClearM);
    expect(ownerSpotTaken(v, second[0]!, second[1]!, second[2]!)).toBe(false);
    expect(sees(v, cam, second)).toBe(true);
    sim.dispose();
  });

  it('revisão: a câmera dentro de um bloco (a livre do Aquário atravessa): os raios saem do lado de fora; funda demais, "Mire no chão"', () => {
    const { recipe, sim, main } = setup();
    const v = sim.view();
    // Dentro da mureta (x 15–19, y 0,5–2,5, z 54–55), olhando para o sul, para o chão a 3,5 m: a 0,5 m sai dela.
    const cam = [17.2, 1.5, 54.5] as const;
    const { yaw, pitch } = aim(cam, [17.2, 0.5, 58]);
    const ground = new Float64Array(3);
    // O raio da câmera bate a 0 m (sem normal): sozinho, ele não acha chão.
    expect(ownerGroundPoint(v, cam[0], cam[1], cam[2], yaw, pitch, ground)).toBe(false);
    const eye = new Float64Array(3);
    expect(ownerRayOrigin(v, cam[0], cam[1], cam[2], yaw, pitch, eye)).toBe(true);
    expect(eye[2]).toBeGreaterThanOrEqual(WALL.maxZ);
    expect(eye[2]).toBeLessThan(WALL.maxZ + 0.3);
    const spot = new Float64Array(3);
    expect(ownerSpawnSpot(v, main, cam[0], cam[1], cam[2], yaw, pitch, spot)).toBeNull();
    expect(spot[2]).toBeGreaterThan(WALL.maxZ);
    expect(Math.hypot(spot[0]! - 17.2, spot[2]! - 58)).toBeLessThan(1);
    expect(sees(v, eye, spot)).toBe(true);
    // No meio da torre central (8 × 8 m, até y 3,5): 3 m pela mira não saem dela. A recusa é "Mire no chão".
    const deep = [40, 2, 40] as const;
    expect(ownerRayOrigin(v, deep[0], deep[1], deep[2], 0, -0.3, eye)).toBe(false);
    expect(ownerSpawnSpot(v, main, deep[0], deep[1], deep[2], 0, -0.3, spot)).toBe('aimGround');
    const sent: OwnerCommand[] = [];
    const tools = createOwnerTools({
      recipe,
      command: (cmd) => {
        sent.push(cmd);
        return sim.command(cmd);
      },
      view: () => sim.view(),
      nameOf: () => 'Bot',
      primaries: PRIMARY_ORDER,
      weaponNames: WEAPON_IDS,
      slowAllowed: true,
      log: () => {},
    });
    tools.action(nav(OWNER_ACTION.spawn));
    tools.apply(v, deep[0], deep[1], deep[2], 0, -0.3, -1, () => false);
    expect(sent).toEqual([]);
    expect(tools.notice).toBe('Mire no chão');
    sim.dispose();
  });

  it('revisão: o clique recusado passa pelos nós uma vez só (não uma por volta) e testa a vista de poucos nós', () => {
    const { sim, main } = setup();
    const v = sim.view();
    const nav0 = v.nav!;
    let positions = 0;
    const counted = Object.create(nav0, {
      nodePosition: {
        value: (node: number, out: Float64Array, offset?: number): void => {
          positions++;
          nav0.nodePosition(node, out, offset);
        },
      },
    }) as typeof nav0;
    const cv = Object.create(v, { nav: { value: counted } }) as SimView;
    // De fora do muro da borda, olhando para o chão de fora: 3 voltas (até a câmera), nenhuma com nó à vista.
    const cam = [1.5, 0.5 + METRICS.eyeHeight, 40] as const;
    const { yaw, pitch } = aim(cam, [1.5, 0.5, 37]);
    const spot = new Float64Array(3);
    expect(ownerSpawnSpot(cv, main, cam[0], cam[1], cam[2], yaw, pitch, spot)).toBe('place');
    let walkable = 0;
    for (let n = 0; n < nav0.nodeCount; n++) if (nav0.clearance[n] === 1 && nav0.component[n] === main) walkable++;
    // Uma passada (um `nodePosition` por nó em pé do componente) mais os candidatos testados (no máximo 5 × 12).
    expect(positions).toBeGreaterThanOrEqual(walkable);
    expect(positions).toBeLessThanOrEqual(walkable + 5 * OWNER_UI.spotPerRound);
    // Da câmera de cima (inclinada para baixo), as voltas de 1 m andam pouco no chão: as que ficam a menos de 0,5 m da
    // anterior não contam, e a passada continua uma só.
    positions = 0;
    const high = [17.2, 30, 70] as const;
    const steep = aim(high, [17.2, WALL.top, 54.4]);
    ownerSpawnSpot(cv, main, high[0], high[1], high[2], steep.yaw, steep.pitch, spot);
    expect(positions).toBeLessThanOrEqual(walkable + 5 * OWNER_UI.spotPerRound);
    sim.dispose();
  });

  it('revisão: dois cliques antes da resposta (o mesmo tick, a câmera lenta) escolhem nós diferentes, os dois à vista', () => {
    const { recipe, sim, step } = setup();
    const v = sim.view();
    const sent: OwnerCommand[] = [];
    const tools = createOwnerTools({
      recipe,
      command: (cmd) => {
        sent.push(cmd);
        return sim.command(cmd);
      },
      view: () => sim.view(),
      nameOf: () => 'Bot',
      primaries: PRIMARY_ORDER,
      weaponNames: WEAPON_IDS,
      slowAllowed: true,
      log: () => {},
    });
    const cam = [17.2, 7, 60] as const;
    const { yaw, pitch } = aim(cam, [17.2, 0.5, 57]);
    tools.action(nav(OWNER_ACTION.spawn));
    tools.apply(v, cam[0], cam[1], cam[2], yaw, pitch, -1, () => false);
    tools.apply(v, cam[0], cam[1], cam[2], yaw, pitch, -1, () => false);
    expect(sent).toHaveLength(2);
    const [a, b] = sent as [Extract<OwnerCommand, { kind: 'spawnBot' }>, Extract<OwnerCommand, { kind: 'spawnBot' }>];
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(OWNER.placeClearM);
    // A sim põe cada um exatamente no nó mandado, os dois à vista da câmera.
    const events = step();
    expect(events.map((ev) => ev.ok)).toEqual([true, true]);
    for (const [k, ev] of events.entries()) {
      const e = entityIndex(ev.entity);
      const c = sent[k] as Extract<OwnerCommand, { kind: 'spawnBot' }>;
      expect(Math.hypot(v.position[e * 3]! - c.x, v.position[e * 3 + 2]! - c.z)).toBeLessThan(1e-4);
      expect(sees(v, cam, Float64Array.of(c.x, c.y, c.z))).toBe(true);
    }
    // Respondidos, o lugar deixa de estar "mandado": o próximo clique vê os bots (ocupado) e vai para outro nó.
    tools.apply(v, cam[0], cam[1], cam[2], yaw, pitch, -1, () => false);
    const c3 = sent[2] as Extract<OwnerCommand, { kind: 'spawnBot' }>;
    expect(ownerSpotTaken(v, c3.x, c3.y, c3.z)).toBe(false);
    sim.dispose();
  });

  it('a plaquinha "CONGELADO" em cima do bot congelado, só na vista e só enquanto ele está congelado', () => {
    const { sim, step } = setup();
    const v = sim.view();
    const bot = entityIndex(sim.controllerEntity(BOT_CONTROLLER_BASE + 2));
    const bx = v.position[bot * 3]!;
    const by = v.position[bot * 3 + 1]!;
    const bz = v.position[bot * 3 + 2]!;
    // A câmera 6 m ao sul do bot, na altura dos olhos, olhando para ele (o rumo 0 olha para −Z).
    const cam = { x: bx, y: by + 1.55, z: bz + 6, yaw: 0, pitch: 0, fovY: 1.2 };
    const rect = { x: 0, y: 0, width: 1280, height: 720 };
    const list = createDrawList(256);
    const label = t('owner.frozenTag').toUpperCase();
    const draw = (
      c: typeof cam = cam,
      self = -1,
      hidden: Uint8Array | null = null,
      view: SimView = v,
      alpha = 1,
    ): { text: string; top: number } => {
      resetDrawList(list, 1280, 720);
      drawFrozenMarks(list, FONTS.hud, view, c, rect, 13, label, self, () => 1, hidden, alpha);
      let top = Infinity;
      for (let k = 0; k < list.count; k++) top = Math.min(top, list.geom[k * DRAW_FLOATS_PER_COMMAND + 1]!);
      return { text: squash(drawnText(list)).toLowerCase(), top };
    };
    expect(label).toBe('CONGELADO');
    // Solto: nada.
    expect(draw().text).toBe('');
    sim.command({ kind: 'freeze', entity: makeEntityId(bot, v.generation[bot]!), on: true });
    step();
    expect(v.owner!.frozen[bot]).toBe(1);
    // Congelado: a plaquinha, acima do meio da tela (em cima da cabeça dele).
    const shown = draw();
    expect(shown.text).toBe('congelado');
    expect(shown.top).toBeLessThan(360);
    // De costas para ele, longe demais, ele mesmo (a vista nos olhos dele), invisível, ou passando da borda de cima: nada.
    expect(draw({ ...cam, yaw: Math.PI }).text).toBe('');
    expect(draw({ ...cam, z: bz + 60 }).text).toBe('');
    expect(draw(cam, bot).text).toBe('');
    const hidden = new Uint8Array(v.capacity);
    hidden[bot] = 1;
    expect(draw(cam, -1, hidden).text).toBe('');
    expect(draw({ ...cam, pitch: -0.5 }).text).toBe('');
    // Revisão: a plaquinha vai na posição desenhada do corpo (entre o tick de antes e o de agora, pelo `alpha`): com
    // o corpo 1 m mais baixo no tick de antes, no alpha 0 ela fica mais baixa na tela, e no alpha 1 igual à de agora.
    const prev = Float64Array.from(v.prevPosition);
    prev[bot * 3 + 1] = by - 1;
    const falling = Object.create(v, { prevPosition: { value: prev } }) as SimView;
    expect(draw(cam, -1, null, falling, 1).top).toBe(shown.top);
    expect(draw(cam, -1, null, falling, 0).top).toBeGreaterThan(shown.top + 20);
    expect(draw(cam, -1, null, falling, 0.5).top).toBeGreaterThan(shown.top + 10);
    // Solto de novo: some.
    sim.command({ kind: 'freeze', entity: makeEntityId(bot, v.generation[bot]!), on: false });
    step();
    expect(draw().text).toBe('');
    sim.dispose();
  });
});

// --- A cena inteira (startGame + NullRenderer) ---

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
function readRuntimeAsset(path: string): Uint8Array {
  const source = RUNTIME.files[path];
  if (!source) throw new Error(`asset desconhecido: ${path}`);
  return new Uint8Array(readFileSync(join(ROOT, 'assets-src', source)));
}
const FONTS = parseFontPack(JSON.parse(new TextDecoder().decode(readRuntimeAsset('fonts/ui-fonts.json')))).fonts;

/** O texto desenhado na lista com as fontes reais (pela posição do glifo no atlas), sem espaços. */
function drawnText(list: DrawList | null): string {
  if (list === null) return '';
  const byLayer = new Map<number, Map<string, number>>();
  for (const font of [FONTS.display, FONTS.hud] as MsdfFont[]) {
    const m = new Map<string, number>();
    for (let i = 0; i < font.glyphData.length; i += 8) {
      m.set(`${font.glyphData[i + 1]}:${font.glyphData[i + 2]}`, font.glyphData[i]!);
    }
    byLayer.set(font.layer, m);
  }
  const font = FONTS.hud;
  let text = '';
  for (let c = 0; c < list.count; c++) {
    if (list.ops[c] !== DRAW_OP.glyph) continue;
    const o = c * DRAW_FLOATS_PER_COMMAND;
    const gx = Math.round(list.geom[o + 4]! * font.atlasWidth);
    const gy = Math.round(list.geom[o + 5]! * font.atlasHeight);
    const code = byLayer.get(list.textures[c]!)?.get(`${gx}:${gy}`);
    text += code === undefined ? '?' : String.fromCharCode(code);
  }
  return text;
}
const squash = (s: string): string => s.replace(/\s+/g, '');

interface FakePlatform extends Platform {
  readonly rawNext: RawInputState;
  readonly logLines: string[];
  pump(n: number, frameMs?: number): void;
  tap(code: string): void;
}

function createFakePlatform(store: Readonly<Record<string, string>>): FakePlatform {
  const noop = (): (() => void) => () => {};
  const saved = new Map<string, string>(Object.entries(store));
  const callbacks = new Map<number, (nowMs: number) => void>();
  const rawNext = createRawInputState();
  rawNext.surfaceWidth = 1280;
  rawNext.surfaceHeight = 720;
  let now = 1000;
  let nextHandle = 1;
  const platform: FakePlatform = {
    id: 'web',
    features: { profileHint: 'pc', touch: false, keyboardMouse: true, reducedMotion: false, canExit: false },
    graphics: {
      kind: 'webgl2',
      context: null,
      canvas: null,
      width: 1280,
      height: 720,
      pixelRatio: 1,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      onResize: noop,
    },
    storage: {
      get: (k) => saved.get(k) ?? null,
      set: (k, v) => void saved.set(k, v),
      remove: (k) => void saved.delete(k),
      keys: () => [...saved.keys()],
      getBackup: () => null,
      flush: async () => {},
    },
    assets: {
      loadBytes: async (path) => readRuntimeAsset(path),
      loadText: async (path) => new TextDecoder().decode(readRuntimeAsset(path)),
    },
    files: null,
    textInput: { available: false, open: () => null },
    lifecycle: { onPause: noop, onResume: noop, onVisibility: noop, setInMatch: () => {} },
    diagnostics: {
      collectReport: async () => ({
        platform: 'web',
        system: 'teste',
        screen: { width: 1280, height: 720, pixelRatio: 1 },
        gpu: 'nenhuma',
        glLimits: {},
        storagePersisted: null,
        extra: {},
      }),
      appendLog: (line) => void platform.logLines.push(line),
    },
    input: {
      poll(out) {
        out.keys.set(rawNext.keys);
        out.mouseDX = rawNext.mouseDX;
        out.mouseDY = rawNext.mouseDY;
        out.mouseButtons = rawNext.mouseButtons;
        out.pointerLocked = rawNext.pointerLocked;
        out.surfaceWidth = rawNext.surfaceWidth;
        out.surfaceHeight = rawNext.surfaceHeight;
        out.pixelRatio = 1;
        // Os controles que o teste liga (o "entrar no meio" do sofá).
        for (let i = 0; i < rawNext.gamepads.length; i++) {
          const src = rawNext.gamepads[i]!;
          const dst = out.gamepads[i]!;
          dst.connected = src.connected;
          dst.id = src.id;
          dst.buttons.set(src.buttons);
          dst.axes.set(src.axes);
        }
        rawNext.mouseDX = 0;
        rawNext.mouseDY = 0;
      },
      vibrate: () => {},
    },
    audio: null,
    online: null,
    now: () => now,
    requestFrame(callback) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      callbacks.delete(handle);
    },
    exit() {},
    rawNext,
    logLines: [],
    pump(n, frameMs = 1000 / 60) {
      for (let i = 0; i < n; i++) {
        now += frameMs;
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const cb of pending) cb(now);
      }
    },
    tap(code) {
      const k = keyIndex(code);
      rawNext.keys[k] = 1;
      platform.pump(1);
      rawNext.keys[k] = 0;
      platform.pump(1);
    },
  };
  return platform;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Uma sessão online de mentira (o host lê os amigos parados; o cliente só manda a entrada). */
function fakeSession(role: 'host' | 'client', ownerReserve: number | undefined): OnlineSession {
  const stats = { sentBytes: 0, receivedBytes: 0, peers: 1, snapshots: 0, lagTicks: -1, reconciles: 0, mispredicts: 0 };
  return {
    role,
    humans: 1,
    localController: 0,
    remoteControllers: [],
    names: ['Erick'],
    ...(ownerReserve !== undefined ? { ownerReserve } : {}),
    closed: false,
    attachHost: () => ({
      receive: () => {},
      writeRemoteFrame: () => false,
      recordEvents: () => {},
      afterTicks: () => {},
      takeLost: () => 0,
      takeControl: () => 0,
      setAway: () => {},
      stats,
      dispose: () => {},
    }),
    attachClient: () => ({
      update: () => 0,
      alpha: 0,
      hostAbsentS: 0,
      hostAwayNotified: false,
      stats,
      dispose: () => {},
    }),
  };
}

/**
 * O JOGAR com a receita como o último preset; `patch` mexe no pedido da cena (o Aquário, o online), como o `game`
 * faria pelos outros caminhos (o Assistir da Partida personalizada, o começo da sala).
 */
async function play(
  recipe: MatchRecipe,
  patch: Partial<SceneRequest> = {},
  saved: Readonly<Record<string, string>> = {},
) {
  const store = {
    ...saved,
    presets: JSON.stringify({ recent: [recipe], saved: [], favorites: [], botFavorites: [] }),
  };
  const platform = createFakePlatform(store);
  let ui: DrawList | null = null;
  /** Fase 5b: a HUD da vista do P1 (a plaquinha de abates e mortes, a vida), `null` quando a vista vai sem HUD. */
  let hud: DrawList | null = null;
  const bundle: SceneBundle = {
    module: { createScene: (host, request) => SCENE_MODULE.createScene(host, { ...request, ...patch }) },
  };
  const game: GameHandle = startGame({
    platform,
    createRenderer: null,
    nullRenderer: () => {
      const r = createNullRenderer();
      r.drawUi = (list, view) => {
        if (view === undefined) ui = list;
      };
      r.renderViews = (views) => {
        hud = views[0]?.hud ?? null;
      };
      return r;
    },
    loadScene: () => Promise.resolve(bundle),
  });
  platform.pump(2);
  await settle();
  platform.pump(2);
  platform.tap('Enter');
  for (let i = 0; i < 200 && game.scene?.phase !== 'running'; i++) {
    platform.pump(1);
    await settle();
  }
  expect(game.scene?.phase).toBe('running');
  // A contagem de 3 s.
  platform.pump(200);
  // O texto desenhado, sem espaços e em minúsculas (os botões e os títulos saem em caixa alta).
  return {
    platform,
    game,
    text: () => squash(drawnText(ui)).toLowerCase(),
    hudText: () => squash(drawnText(hud)).toLowerCase(),
  };
}

/** O Sandbox no Construto: o jogador e 3 Vibe Bob de cada lado; o objetivo "nenhum" (não acaba sozinho). */
const SANDBOX: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'sandbox',
  map: 'construto',
  seed: 0,
  sandbox: { objective: 'none' },
  teams: [{ humans: 'all', bots: [{ ref: vibe, count: 3 }] }, { bots: [{ ref: vibe, count: 3 }] }],
};

/** Os bots da reserva (os controladores depois dos da receita) que estão em jogo. */
const reserveActive = (v: SimView): number => {
  let n = 0;
  for (let i = 0; i < v.count; i++) {
    if (v.alive[i] === 1 && v.controller[i]! >= v.owner!.reserveBase && !isOwnerDormant(v, i)) n++;
  }
  return n;
};

describe('as Ferramentas do Dono na cena (startGame, NullRenderer)', () => {
  it('Sandbox offline: a reserva de 8, a página na pausa, "criar bot" onde mira com o aviso, o placar sem os de fora e a câmera lenta', async () => {
    // A semente da partida fixa (o JOGAR sorteia uma): os nomes da reserva saem dela.
    const { platform, game, text, hudText } = await play(SANDBOX, { seed: 777 });
    const sim = game.match!.sim;
    const v = sim.view();
    expect(v.owner).not.toBeNull();
    expect(v.owner!.reserve).toBe(8);
    expect(ownerDormantCount(v)).toBe(8);
    // Fase 5b: cada bot da reserva com o nome dele (a mesma conta da cena).
    const names = controllerNames({ ...SANDBOX, seed: 777 }, 1);
    addReserveNames(names, { ...SANDBOX, seed: 777 }, 1, 8);
    const reserveNames = names.slice(v.owner!.reserveBase).map((n) => squash(n).toLowerCase());
    expect(reserveNames).toHaveLength(8);
    // O placar (Tab) não lista os 8 da reserva: só os 7 da partida.
    platform.rawNext.keys[keyIndex('Tab')] = 1;
    platform.pump(2);
    expect(text()).toContain('vibebob');
    for (const name of reserveNames) expect(text()).not.toContain(name);
    platform.rawNext.keys[keyIndex('Tab')] = 0;
    platform.pump(2);
    // A pausa: o botão das ferramentas no canto de cima (para cima do Continuar); Enter abre a página, Enter arma.
    platform.tap('KeyP');
    expect(game.paused).toBe(true);
    expect(text()).toContain('ferramentas');
    // Fase 5b (prints): na pausa, a HUD do P1 fica (apagada pelo véu); na página do dono, sai (o Voltar do canto ficava
    // em cima da plaquinha de abates e mortes).
    expect(hudText()).toContain('abates');
    platform.tap('ArrowUp');
    platform.tap('Enter');
    expect(text()).toContain('criarbot');
    expect(text()).toContain('câmeralenta');
    expect(text()).toContain('botsnareserva:8');
    expect(hudText()).not.toContain('abates');
    expect(hudText()).toBe('');
    // Os modificadores também (e voltando dela, o foco fica nos Modificadores: 4 para cima até o Criar bot).
    for (let i = 0; i < 4; i++) platform.tap('ArrowDown');
    platform.tap('Enter');
    expect(text()).toContain('modificadoresaovivo');
    expect(hudText()).toBe('');
    platform.tap('Backspace');
    expect(text()).toContain('criarbot');
    for (let i = 0; i < 4; i++) platform.tap('ArrowUp');
    platform.tap('Enter');
    expect(game.paused).toBe(false);
    expect(platform.logLines).toContain('[partida] dono: armou own.spawn');
    platform.pump(2);
    // A faixa da ferramenta e os botões do teclado e mouse.
    expect(text()).toContain('criarbot·laranja');
    expect(text()).toContain('mouseesquerdo:aplicar·mousedireito:cancelar');
    // Mira no chão (o mouse com o ponteiro preso) e atira: o tiro não sai, o comando vai.
    platform.rawNext.pointerLocked = true;
    for (let i = 0; i < 6; i++) {
      platform.rawNext.mouseDY = 120;
      platform.pump(1);
    }
    const me = entityIndex(sim.controllerEntity(0));
    const shots = v.kills[me];
    platform.rawNext.mouseButtons = MOUSE_BUTTON.left;
    platform.pump(2);
    platform.rawNext.mouseButtons = 0;
    platform.pump(3);
    expect((v.flags[me]! & ENTITY_FLAG.firing) === 0).toBe(true);
    expect(v.kills[me]).toBe(shots);
    expect(platform.logLines).toContain('[partida] dono: criar bot no time 0');
    expect(platform.logLines).toContain('[partida] dono: spawnBot ok');
    expect(reserveActive(v)).toBe(1);
    expect(ownerDormantCount(v)).toBe(7);
    const spawned = [...Array(v.count).keys()].find(
      (i) => v.controller[i]! >= v.owner!.reserveBase && !isOwnerDormant(v, i) && v.alive[i] === 1,
    )!;
    expect(v.team[spawned]).toBe(0);
    const d = Math.hypot(
      v.position[spawned * 3]! - v.position[me * 3]!,
      v.position[spawned * 3 + 2]! - v.position[me * 3 + 2]!,
    );
    expect(d).toBeLessThan(12);
    // O aviso na tela com o nome do 1º da reserva, e o novo bot no placar (só ele da reserva).
    expect(text()).toContain(`botcriado:${reserveNames[0]}`);
    expect(hudText()).toContain('abates');
    platform.rawNext.keys[keyIndex('Tab')] = 1;
    platform.pump(2);
    expect(text()).toContain(reserveNames[0]);
    for (const name of reserveNames.slice(1)) expect(text()).not.toContain(name);
    platform.rawNext.keys[keyIndex('Tab')] = 0;
    // A mira (botão direito) cancela.
    platform.rawNext.mouseButtons = MOUSE_BUTTON.right;
    platform.pump(2);
    platform.rawNext.mouseButtons = 0;
    platform.pump(2);
    expect(platform.logLines).toContain('[partida] dono: desarmou');
    expect(text()).not.toContain('criarbot·');
    // A câmera lenta: a 0,5× a sim anda metade dos ticks por segundo.
    const t0 = sim.tick;
    platform.pump(60);
    const normalTicks = sim.tick - t0;
    platform.tap('KeyP');
    platform.tap('ArrowUp');
    platform.tap('Enter');
    for (let i = 0; i < 4; i++) platform.tap('ArrowDown');
    platform.tap('ArrowRight');
    platform.tap('Enter');
    expect(platform.logLines).toContain('[partida] dono: câmera lenta 0,5×');
    platform.tap('KeyP');
    expect(game.paused).toBe(false);
    const t1 = sim.tick;
    platform.pump(60);
    const slowTicks = sim.tick - t1;
    expect(normalTicks).toBeGreaterThanOrEqual(58);
    expect(Math.abs(slowTicks - normalTicks / 2)).toBeLessThanOrEqual(2);
    game.dispose();
  }, 180_000);

  it('Aquário de um Sandbox: a ferramenta vale da câmera livre (o raio sai do meio da tela), sem a câmera lenta', async () => {
    const { platform, game, text } = await play(SANDBOX, { spectate: true });
    const sim = game.match!.sim;
    const v = sim.view();
    expect(v.owner!.reserve).toBe(8);
    // A câmera livre (T três vezes: olhos, livre) e olhando para baixo.
    platform.tap('KeyT');
    platform.tap('KeyT');
    platform.rawNext.pointerLocked = true;
    for (let i = 0; i < 8; i++) {
      platform.rawNext.mouseDY = 150;
      platform.pump(1);
    }
    platform.tap('KeyP');
    expect(text()).toContain('ferramentas');
    platform.tap('ArrowUp');
    platform.tap('Enter');
    expect(text()).not.toContain('câmeralenta');
    platform.tap('Enter');
    platform.pump(2);
    platform.rawNext.mouseButtons = MOUSE_BUTTON.left;
    platform.pump(2);
    platform.rawNext.mouseButtons = 0;
    platform.pump(3);
    expect(platform.logLines).toContain('[partida] dono: spawnBot ok');
    expect(reserveActive(v)).toBe(1);
    game.dispose();
  }, 180_000);

  it('fora do Sandbox, nada: sem reserva, sem a página', async () => {
    const tdm = withoutSandbox(SANDBOX, 'warfare.tdm');
    const { platform, game, text } = await play(tdm);
    expect(game.match!.sim.view().owner).toBeNull();
    platform.tap('KeyP');
    expect(text()).toContain('continuar');
    expect(text()).not.toContain('ferramentas');
    game.dispose();
  }, 180_000);

  it('online: o host tem a página sem a câmera lenta; o amigo cria a sim com a reserva do começo e não tem a página', async () => {
    const host = await play(SANDBOX, { online: fakeSession('host', 8) });
    expect(host.game.match!.sim.view().owner!.reserve).toBe(8);
    host.platform.tap('KeyP');
    expect(host.text()).toContain('ferramentas');
    host.platform.tap('ArrowUp');
    host.platform.tap('Enter');
    expect(host.text()).toContain('criarbot');
    expect(host.text()).not.toContain('câmeralenta');
    host.game.dispose();
    const client = await play(SANDBOX, { online: fakeSession('client', 8) });
    const cv = client.game.match!.sim.view();
    expect(cv.owner!.reserve).toBe(8);
    expect(client.game.match!.command({ kind: 'setModifier', modifier: 'mini', on: true })).toBe(-1);
    client.platform.tap('KeyP');
    expect(client.text()).not.toContain('ferramentas');
    client.game.dispose();
  }, 180_000);
});

/** Os bots da receita (sem a reserva), pelo índice da entidade. */
function recipeBots(v: SimView): number[] {
  const out: number[] = [];
  for (let i = 0; i < v.count; i++) {
    const c = v.controller[i]!;
    if (v.alive[i] === 1 && v.kind[i] === ENTITY_KIND.bobo && c >= BOT_CONTROLLER_BASE && c < v.owner!.reserveBase) {
      out.push(i);
    }
  }
  return out;
}
const frozenBots = (v: SimView): number => recipeBots(v).filter((i) => v.owner!.frozen[i] === 1).length;

/** Abre a página do dono e arma o "Criar bot" (o foco começa nele). */
function armSpawn(platform: FakePlatform): void {
  platform.tap('KeyP');
  platform.tap('ArrowUp');
  platform.tap('Enter');
  platform.tap('Enter');
}

describe('as Ferramentas do Dono na cena: a revisão', () => {
  it('com "Mirar: alternar", armar e cancelar soltam o ADS, e o aperto do cancelar não vira mira', async () => {
    const kbm = { ...DEFAULT_SETTINGS.controls.keyboardMouse, toggleAds: true };
    const settings = JSON.stringify({
      ...DEFAULT_SETTINGS,
      controls: { ...DEFAULT_SETTINGS.controls, keyboardMouse: kbm },
    });
    const { platform, game } = await play(SANDBOX, {}, { settings });
    const sim = game.match!.sim;
    const v = sim.view();
    const me = entityIndex(sim.controllerEntity(0));
    const ads = (): boolean => (v.flags[me]! & ENTITY_FLAG.ads) !== 0;
    const right = (frames: number): boolean => {
      let seen = false;
      platform.rawNext.mouseButtons = MOUSE_BUTTON.right;
      for (let i = 0; i < 3; i++) {
        platform.pump(1);
        seen ||= ads();
      }
      platform.rawNext.mouseButtons = 0;
      for (let i = 0; i < frames; i++) {
        platform.pump(1);
        seen ||= ads();
      }
      return seen;
    };
    platform.rawNext.pointerLocked = true;
    // O ADS alternado ligado antes de armar.
    right(10);
    expect(ads()).toBe(true);
    armSpawn(platform);
    expect(platform.logLines).toContain('[partida] dono: armou own.spawn');
    platform.pump(10);
    expect(ads()).toBe(false);
    // O cancelar (a mira): nenhum quadro com o bobo mirando, e depois dele o ADS continua solto.
    expect(right(10)).toBe(false);
    expect(platform.logLines).toContain('[partida] dono: desarmou');
    expect(ads()).toBe(false);
    // A próxima mira volta a valer (alternada).
    right(10);
    expect(ads()).toBe(true);
    game.dispose();
  }, 180_000);

  it('no online, os apertos com a pausa aberta (a página do dono) não chegam ao bobo do host', async () => {
    const { platform, game } = await play(SANDBOX, { online: fakeSession('host', 8) });
    const sim = game.match!.sim;
    const v = sim.view();
    const me = entityIndex(sim.controllerEntity(0));
    const firing = (): boolean => (v.flags[me]! & ENTITY_FLAG.firing) !== 0;
    const hold = (button: number, frames: number): boolean => {
      let seen = false;
      platform.rawNext.mouseButtons = button;
      for (let i = 0; i < frames; i++) {
        platform.pump(1);
        seen ||= firing();
      }
      platform.rawNext.mouseButtons = 0;
      platform.pump(2);
      return seen;
    };
    platform.rawNext.pointerLocked = true;
    platform.tap('KeyP');
    platform.tap('ArrowUp');
    platform.tap('Enter');
    expect(game.paused).toBe(true);
    const t0 = sim.tick;
    expect(hold(MOUSE_BUTTON.left, 20)).toBe(false);
    // A sim andou (online não pausa), só o tiro não saiu.
    expect(sim.tick).toBeGreaterThan(t0 + 15);
    // Fechada a pausa, o clique atira. M12 (fase 3): o Esc numa página da pausa volta um nível (à pausa); o 2º fecha.
    platform.tap('Escape');
    expect(game.paused).toBe(true);
    platform.tap('Escape');
    expect(game.paused).toBe(false);
    expect(hold(MOUSE_BUTTON.left, 20)).toBe(true);
    game.dispose();
  }, 180_000);

  it('com o seu bobo fora de jogo (morto), a ferramenta não aplica pela câmera de morte', async () => {
    const recipe: MatchRecipe = {
      ...SANDBOX,
      teams: [{ humans: 'all', bots: [], hp: 1 }, { bots: [{ ref: builtinBotRef('tryhard'), count: 4 }] }],
    };
    const { platform, game, text } = await play(recipe);
    const sim = game.match!.sim;
    const v = sim.view();
    const me = entityIndex(sim.controllerEntity(0));
    platform.rawNext.pointerLocked = true;
    armSpawn(platform);
    platform.pump(2);
    for (let i = 0; i < 60 * 60 && (v.flags[me]! & ENTITY_FLAG.dead) === 0; i++) platform.pump(1);
    expect(v.flags[me]! & ENTITY_FLAG.dead).toBe(ENTITY_FLAG.dead);
    platform.rawNext.mouseButtons = MOUSE_BUTTON.left;
    platform.pump(2);
    platform.rawNext.mouseButtons = 0;
    platform.pump(1);
    expect(text()).toContain('sócomoseuboboemjogo');
    expect(platform.logLines.some((l) => l.startsWith('[partida] dono: criar bot'))).toBe(false);
    game.dispose();
  }, 180_000);

  it('o bot congelado não recebe quem entra no meio do sofá; assumido no Aquário, ele volta a se mexer', async () => {
    const couch = await play(SANDBOX, { seats: [{ device: { kind: 'keyboardMouse' }, side: 0 }] });
    const d = couch.game.match!;
    const v = d.sim.view();
    const freeze = (i: number, on: boolean): number =>
      d.command({ kind: 'freeze', entity: makeEntityId(i, v.generation[i]!), on });
    for (const i of recipeBots(v)) freeze(i, true);
    couch.platform.pump(2);
    expect(frozenBots(v)).toBe(6);
    const pad = couch.platform.rawNext.gamepads[0]!;
    pad.connected = true;
    pad.id = 'controle de teste';
    const holdJoin = (): void => {
      pad.buttons[PAD_BUTTON.faceDown] = 1;
      couch.platform.pump(80);
      pad.buttons[PAD_BUTTON.faceDown] = 0;
      couch.platform.pump(2);
    };
    const joined = (): boolean => couch.platform.logLines.some((l) => l.includes('entrou no meio'));
    holdJoin();
    expect(joined()).toBe(false);
    // Um solto: ele recebe o P2.
    freeze(recipeBots(v)[0]!, false);
    couch.platform.pump(2);
    holdJoin();
    expect(joined()).toBe(true);
    couch.game.dispose();

    const aq = await play(SANDBOX, { spectate: true });
    const a = aq.game.match!;
    const av = a.sim.view();
    for (const i of recipeBots(av)) a.command({ kind: 'freeze', entity: makeEntityId(i, av.generation[i]!), on: true });
    aq.platform.pump(2);
    expect(frozenBots(av)).toBe(7);
    aq.platform.tap('KeyE');
    aq.platform.pump(2);
    expect(aq.platform.logLines.some((l) => l.startsWith('[partida] aquário: assumiu'))).toBe(true);
    expect(frozenBots(av)).toBe(6);
    aq.game.dispose();
  }, 180_000);

  it('fase 5b: a plaquinha "CONGELADO" fica em cima dos congelados (o Aquário seguindo um, a câmera livre e o amigo online)', async () => {
    const aq = await play(SANDBOX, { spectate: true });
    const a = aq.game.match!;
    const av = a.sim.view();
    const freezeAll = (on: boolean): void => {
      for (const i of recipeBots(av)) a.command({ kind: 'freeze', entity: makeEntityId(i, av.generation[i]!), on });
      aq.platform.pump(2);
    };
    // Ninguém congelado: nada.
    expect(aq.hudText()).not.toContain('congelado');
    // Todos congelados: a câmera que segue um bot (atrás dele) vê a plaquinha em cima da cabeça dele. Revisão: na lista
    // da HUD da vista (por baixo das plaquinhas dela), não na da tela.
    freezeAll(true);
    expect(frozenBots(av)).toBe(7);
    expect(aq.hudText()).toContain('congelado');
    expect(aq.text()).not.toContain('congelado');
    // A câmera livre (sem HUD) também: ela sai dos olhos do bot seguido; um pouco para trás, ele aparece na frente.
    aq.platform.tap('KeyT');
    aq.platform.tap('KeyT');
    aq.platform.rawNext.keys[keyIndex('KeyS')] = 1;
    aq.platform.pump(20);
    aq.platform.rawNext.keys[keyIndex('KeyS')] = 0;
    aq.platform.pump(2);
    expect(aq.text()).toContain('câmeralivre');
    expect(aq.hudText()).toBe('');
    expect(aq.text()).toContain('congelado');
    // Na pausa, a plaquinha sai (o véu cobre a partida).
    aq.platform.tap('KeyP');
    expect(aq.game.paused).toBe(true);
    expect(aq.text()).not.toContain('congelado');
    aq.platform.tap('KeyP');
    // Soltos: some.
    freezeAll(false);
    expect(frozenBots(av)).toBe(0);
    expect(aq.text()).not.toContain('congelado');
    expect(aq.hudText()).not.toContain('congelado');
    aq.game.dispose();

    // O amigo online não tem as ferramentas, mas vê os congelados do host (o congelado vem no snapshot).
    const client = await play(SANDBOX, { online: fakeSession('client', 8) });
    const cv = client.game.match!.sim.view();
    expect(cv.owner).not.toBeNull();
    // (O snapshot de mentira não chega: a marca vai direto no estado do dono da sim do amigo.) Girando a câmera, algum
    // congelado aparece com a plaquinha.
    expect(client.hudText()).not.toContain('congelado');
    for (const i of recipeBots(cv)) cv.owner!.frozen[i] = 1;
    client.platform.rawNext.pointerLocked = true;
    let seen = false;
    for (let k = 0; k < 90 && !seen; k++) {
      client.platform.rawNext.mouseDX = 60;
      client.platform.pump(1);
      seen = client.hudText().includes('congelado');
    }
    expect(seen).toBe(true);
    client.game.dispose();
  }, 180_000);
});

describe('a página do dono e a pausa com o item cabem (atlas real)', () => {
  const TARGETS = [
    { name: 'web 1280×720', w: 1280, h: 720, minTextPx: MIN_TEXT.phone, minTarget: 0 },
    { name: 'web 640×360', w: 640, h: 360, minTextPx: MIN_TEXT.phone, minTarget: 0 },
    { name: 'celular 1334×750', w: 1334, h: 750, minTextPx: MIN_TEXT.phone * 2, minTarget: MIN_TOUCH_TARGET * 2 },
    { name: 'web 4:3 1024×768', w: 1024, h: 768, minTextPx: MIN_TEXT.phone, minTarget: 0 },
    { name: 'Switch 1280×720', w: 1280, h: 720, minTextPx: MIN_TEXT.tv, minTarget: 0 },
  ] as const;
  const longestHelp = (
    [
      'owner.help.spawn',
      'owner.help.freeze',
      'owner.help.team',
      'owner.help.weapon',
      'owner.help.remove',
      'owner.help.mods',
      'owner.help.slow',
      'owner.help.mod',
    ] as const
  )
    .map((k) => t(k))
    .reduce((a, b) => (b.length > a.length ? b : a));
  const tools = ownerToolsScreen({
    spawnTeam: 'MMMMMMMMMMMMMMM',
    team: 'Roxo',
    weapon: 'Big Brrt',
    slow: '0,25×',
    reserve: 16,
    focus: 'own-spawn',
    help: longestHelp,
  });
  const mods = ownerModsScreen({ on: OWNER_LIVE_MODIFIERS.map(() => true), focus: 'own-back', help: longestHelp });
  /** As telas, o que não pode passar da tela (`strict`: o texto também) e os passos do D-pad: [de, direção, para]. */
  const roots: readonly (readonly [
    string,
    UiNode,
    boolean,
    readonly (readonly [string, 'up' | 'down' | 'left' | 'right', string])[],
  ])[] = [
    [
      'ferramentas',
      tools,
      true,
      [
        ['own-spawn', 'down', 'own-team'],
        ['own-team', 'down', 'own-weapon'],
        ['own-freeze', 'right', 'own-remove'],
        ['own-freeze', 'down', 'own-mods'],
        ['own-remove', 'down', 'own-slow'],
        ['own-mods', 'right', 'own-slow'],
        ['own-team', 'up', 'own-spawn'],
        ['own-spawn', 'up', 'own-back'],
      ],
    ],
    [
      'modificadores',
      mods,
      true,
      [
        ['own-mod-lowGravity', 'right', 'own-mod-heavyGravity'],
        ['own-mod-heavyGravity', 'right', 'own-mod-speed'],
        ['own-mod-lowGravity', 'down', 'own-mod-headshotOnly'],
        ['own-mod-bigHead', 'down', 'own-mod-mini'],
        ['own-mod-mini', 'right', 'own-mod-giantBots'],
        ['own-mod-giantBots', 'right', 'own-mod-ricochet'],
        ['own-mod-lowGravity', 'up', 'own-back'],
      ],
    ],
    [
      'pausa do Sandbox',
      pauseScreen.build({ challenge: true, owner: true, help: t('pause.help.owner') }),
      true,
      [
        ['resume', 'up', 'owner'],
        ['owner', 'down', 'resume'],
        ['resume', 'down', 'challenge'],
        ['challenge', 'down', 'settings'],
        ['settings', 'down', 'unstuck'],
        ['unstuck', 'down', 'quit'],
      ],
    ],
    [
      // A coluna é a de sempre do Aquário (no celular o título já passava do alto: a conta dos textos é de antes).
      'pausa do Aquário do Sandbox',
      pauseScreen.build({
        challenge: true,
        owner: true,
        help: t('pause.help.owner'),
        items: aquariumPauseItems({ speed: '0,25×', piloting: false, canTake: true, challenge: true, list: true }),
      }),
      false,
      [
        ['resume', 'up', 'owner'],
        ['resume', 'down', 'speed'],
        ['speed', 'down', 'take'],
        ['list', 'down', 'settings'],
        ['settings', 'down', 'quit'],
      ],
    ],
  ];

  it('texto dentro dos botões, alvos de toque, nada fora da tela nem por cima, e o D-pad passa por todos', () => {
    for (const tg of TARGETS) {
      for (const [name, root, strict, moves] of roots) {
        const layout = layoutTree(root, { x: 0, y: 0, w: tg.w, h: tg.h }, 1, {
          fonts: FONTS,
          minTextPx: tg.minTextPx,
          minTarget: tg.minTarget,
        });
        const c = layout.content;
        const drawn: { id: string; r: { x: number; y: number; w: number; h: number } }[] = [];
        for (const node of layout.order) {
          const r = layout.rects.get(node)!;
          const text = layout.texts.get(node);
          if (!text) continue;
          const at = `${tg.name} ${name}: ${node.kind === 'button' ? node.id : `"${text.text}"`}`;
          expect(text.px, at).toBeGreaterThanOrEqual(tg.minTextPx);
          if (node.kind === 'button') {
            drawn.push({ id: node.id ?? '', r });
            const value = layout.values.get(node);
            const valueW = value ? (node.valueWidth ?? OPTION.valueWidth) * layout.scale : 0;
            const pad = (node.compact ? 13 : BUTTON.padX) * layout.scale;
            const room = r.w - 2 * pad - valueW;
            expect(text.width, `${at} "${text.text}" em ${room.toFixed(1)} px`).toBeLessThanOrEqual(room + 0.5);
            expect(r.h, at).toBeGreaterThanOrEqual(tg.minTarget);
            expect(r.x, at).toBeGreaterThanOrEqual(c.x - 0.5);
            expect(r.x + r.w, at).toBeLessThanOrEqual(c.x + c.w + 0.5);
            expect(r.y, at).toBeGreaterThanOrEqual(c.y - 0.5);
            expect(r.y + r.h, at).toBeLessThanOrEqual(c.y + c.h + 0.5);
            if (value) {
              const between = ((node.valueWidth ?? OPTION.valueWidth) - 2 * OPTION.arrow) * layout.scale;
              expect(value.width, `${at}: "${value.text}"`).toBeLessThanOrEqual(between);
            }
          } else if (strict) {
            // O título, a reserva e a frase de ajuda (centrada, pode passar da coluna) dentro da tela.
            const mid = r.x + r.w / 2;
            expect(mid - text.width / 2, at).toBeGreaterThanOrEqual(c.x - 0.5);
            expect(mid + text.width / 2, at).toBeLessThanOrEqual(c.x + c.w + 0.5);
            expect(r.y, at).toBeGreaterThanOrEqual(c.y - 1);
            expect(r.y + r.h, at).toBeLessThanOrEqual(c.y + c.h + 1);
          }
        }
        // O botão do canto (Ferramentas, Voltar) não cobre nenhum outro.
        for (const a of drawn) {
          for (const b of drawn) {
            if (a === b) continue;
            const apart =
              a.r.x + a.r.w <= b.r.x || b.r.x + b.r.w <= a.r.x || a.r.y + a.r.h <= b.r.y || b.r.y + b.r.h <= a.r.y;
            expect(apart, `${tg.name} ${name}: ${a.id} × ${b.id}`).toBe(true);
          }
        }
        for (const [from, dir, to] of moves) {
          expect(moveFocus(layout, from, dir), `${tg.name} ${name}: ${from} ${dir}`).toBe(to);
        }
      }
    }
  });

  it('no sofá, só o P1 tem as ferramentas (o P2 a P4 vê Continuar e Sair do sofá)', () => {
    const ids = (root: UiNode): string[] => buttons(root).map((b) => b.id);
    expect(ids(pauseScreen.build({ challenge: true, owner: true }))).toContain('owner');
    expect(ids(pauseScreen.build({ challenge: true, owner: true, player: 1 }))).toEqual(['resume', 'leave']);
    expect(ids(pauseScreen.build({ challenge: true }))).not.toContain('owner');
  });
});

describe('fase 5b (prints): o "criar bot" no Construto de verdade', () => {
  /** O Construto pelo caminho do loading (a grade, as props e a navegação de verdade), como o `sandbox-maps.test`. */
  function loadConstruto() {
    const text = (path: string): string => new TextDecoder().decode(readRuntimeAsset(path));
    const manifest = parseLayerManifest(JSON.parse(text('textures/blocos16.json')) as unknown);
    const layers = new Map(manifest.layers.map((l, i) => [l.name, i] as const));
    const world = buildMapWorld({
      map: decodeMap(readRuntimeAsset('maps/construto.bfmap')),
      blockDefs: parseBlockDefs(JSON.parse(text('blocks/blocks.json')) as unknown),
      blockLayer: (name) => layers.get(name),
      models: decodeModelPack(readRuntimeAsset('models/modelos.bfmodel')).models,
    });
    return buildSimMap(world, buildMapNav(world));
  }

  it('mirando no pé de uma parede e no alto de um muro: antes o bot nascia atrás, fora da vista; agora, do lado da câmera', () => {
    const recipe: MatchRecipe = {
      ...SANDBOX,
      seed: 1,
      teams: [{ humans: 1, bots: [{ ref: normal, count: 2 }] }, { bots: [] }],
    };
    const sim = createSim({ recipe, map: loadConstruto(), humans: 1, owner: { reserve: 8 } });
    const v = sim.view();
    const main = navMainComponent(v.nav!);
    const sees = (o: readonly number[], p: ArrayLike<number>): boolean =>
      ownerSees(v, o[0]!, o[1]!, o[2]!, p[0]!, p[1]! + 1.1, p[2]!) ||
      ownerSees(v, o[0]!, o[1]!, o[2]!, p[0]!, p[1]! + METRICS.eyeHeight, p[2]!);
    // Achados por sorteio (4.000 mirados no Construto): de pé, mirando numa parede a 17 m e no chão a 4 m (o nó mais
    // perto fica atrás de um obstáculo baixo); e a câmera alta (como a livre do Aquário) mirando no alto de um muro.
    const cases = [
      { cam: [54.5, 2.55, 59.5], yaw: -1.777066225278402, pitch: 0.03758976211538545 },
      { cam: [18.5, 2.55, 66.5], yaw: 0.16318507681060135, pitch: -0.3577256123302504 },
      { cam: [26.5, 7, 11.5], yaw: -2.4067351382246294, pitch: -0.5002034963108599 },
    ] as const;
    const ground = new Float64Array(3);
    const spot = new Float64Array(3);
    const nodes = new Int32Array(OWNER.placeTries);
    const d2 = new Float64Array(OWNER.placeTries);
    for (const { cam, yaw, pitch } of cases) {
      const [ox, oy, oz] = cam;
      // Antes: o ponto do chão com 0,3 m antes da parede e o nó livre mais perto dele (a conta da sim, até 8 m).
      expect(ownerGroundPoint(v, ox, oy, oz, yaw, pitch, ground, -0.3)).toBe(true);
      const n = ownerSpotNodes(v.nav!, main, v.playArea, ground[0]!, ground[1]!, ground[2]!, 8, nodes, d2);
      expect(n).toBeGreaterThan(0);
      const before = new Float64Array(3);
      v.nav!.nodePosition(nodes[0]!, before, 0);
      expect(ownerSpotTaken(v, before[0]!, before[1]!, before[2]!)).toBe(false);
      expect(sees(cam, before), `antes ${before.join(', ')}`).toBe(false);
      // Agora: um nó à vista, a menos de 2,5 m (no chão) de onde o raio bateu.
      expect(ownerSpawnSpot(v, main, ox, oy, oz, yaw, pitch, spot)).toBeNull();
      expect(sees(cam, spot), `agora ${spot.join(', ')}`).toBe(true);
      expect(Math.hypot(spot[0]! - ground[0]!, spot[2]! - ground[2]!)).toBeLessThan(2.5);
    }
    sim.dispose();
  });
});
