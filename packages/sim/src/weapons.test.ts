import { isKnownContentId, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT, type InputFrame } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { BASE_HP, METRICS } from './config/metrics.ts';
import {
  DEFAULT_LOADOUT_REST,
  isPrimaryWeapon,
  WEAPON_CODE,
  WEAPON_FIRE,
  WEAPON_GRENADE,
  WEAPON_KNIFE,
  WEAPON_PISTOL,
  WEAPON_RIFLE,
  WEAPON_SHOTGUN,
  WEAPON_SLOT,
  WEAPON_SMG,
  WEAPON_SNIPER,
  WEAPONS,
  type WeaponDef,
} from './config/weapons.ts';
import { SIM_HZ } from './constants.ts';
import { entityIndex } from './entity.ts';
import type { SimEvent } from './events.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';
import { heldClip, heldReserve } from './view.ts';

/**
 * M2, fase 1a: as 8 armas (gameplay.md §4.3). A tabela confere os números de projeto (tiros para matar e TTK); a sim
 * confere loadout, troca de slot, primária do próximo spawn, escopeta, recarga por cartucho, faca e ADS da sniper.
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const FLOOR = 0.5;

function flatMap(spawns: MapSpawn[]): SimMap {
  const grid = createWorldGrid(40, 16, 120);
  fillBox(grid, 0, 0, 0, 39, 0, 119, concrete);
  return { grid, blocks, spawns };
}

function duelRecipe(): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 11,
    teams: [
      { humans: 1, bots: [] },
      { humans: 1, bots: [] },
    ],
  };
}

/** Dois bobos frente a frente: o 0 em `z0` olhando para -Z e o 1 em `z1` (< z0) olhando para +Z. */
function duel(z0: number, z1: number, primaries?: number[]): { sim: Sim; f: InputFrame[] } {
  const a: MapSpawn = { x: cellCenter(20), y: FLOOR, z: z0, yaw: 0, team: 0 };
  const b: MapSpawn = { x: cellCenter(20), y: FLOOR, z: z1, yaw: Math.PI, team: 1 };
  const sim = createSim({
    recipe: duelRecipe(),
    map: flatMap([a, b]),
    humans: 2,
    ...(primaries ? { primaries } : {}),
  });
  return { sim, f: createInputFrames() };
}

function run(sim: Sim, f: InputFrame[], ticks: number, onEvents?: (events: SimEvent[]) => void): void {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(f);
    events.length = 0;
    sim.drainEvents(events);
    onEvents?.(events);
  }
}

function entity(sim: Sim, c: number): number {
  return entityIndex(sim.controllerEntity(c));
}

function aimPointOf(sim: Sim, c: number, head = false): AimPoint {
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  aimPointWorld(sim.view(), entity(sim, c), head, p);
  return p;
}

/** Aponta o controlador `c` para o ponto (x, y, z) a partir do olho em pé. */
function aimAt(sim: Sim, f: InputFrame, c: number, p: AimPoint): void {
  const v = sim.view();
  const e = entity(sim, c);
  const dx = p.x - v.position[e * 3]!;
  const dy = p.y - (v.position[e * 3 + 1]! + METRICS.eyeHeight);
  const dz = p.z - v.position[e * 3 + 2]!;
  f.yaw = yawToU16(Math.atan2(-dx, -dz));
  f.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
}

/** Passa a proteção de spawn (1,5 s) dos dois. */
const PAST_PROTECTION = Math.round(1.6 * SIM_HZ);

describe('tabela das armas (gameplay.md §4.3)', () => {
  it('códigos estáveis, IDs de conteúdo conhecidos e cada arma no slot certo', () => {
    WEAPONS.forEach((w, code) => {
      expect(w.code).toBe(code);
      expect(isKnownContentId(`weapon:${w.id}`), w.id).toBe(true);
    });
    expect(WEAPON_CODE.rifle).toBe(0);
    for (const id of ['rifle', 'smg', 'shotgun', 'sniper', 'rocket', 'lmg'] as const)
      expect(isPrimaryWeapon(WEAPON_CODE[id]), id).toBe(true);
    expect(isPrimaryWeapon(WEAPON_CODE.pistol)).toBe(false);
    expect(DEFAULT_LOADOUT_REST.map((c) => WEAPONS[c]!.slot)).toEqual([
      WEAPON_SLOT.secondary,
      WEAPON_SLOT.melee,
      WEAPON_SLOT.throwable,
    ]);
  });

  it('tiros para matar (corpo / cabeça) e TTK sem errar', () => {
    const shots = (dmg: number): number => Math.ceil(BASE_HP / dmg);
    const ttk = (w: WeaponDef): number => ((shots(w.damage) - 1) * 60) / w.rpm;
    const table: Record<string, [number, number]> = {
      pistol: [4, 3],
      smg: [5, 4],
      rifle: [4, 3],
      sniper: [2, 1],
      lmg: [5, 4],
    };
    for (const [id, [body, head]] of Object.entries(table)) {
      const w = WEAPONS.find((x) => x.id === id)!;
      expect(shots(w.damage), id).toBe(body);
      expect(shots(w.damage * w.headMultiplier), id).toBe(head);
    }
    expect(ttk(WEAPON_RIFLE)).toBeCloseTo(0.3, 5);
    expect(ttk(WEAPON_SMG)).toBeCloseTo(0.28, 2);
    expect(ttk(WEAPON_PISTOL)).toBeCloseTo(0.45, 5);
    // Escopeta: os 8 chumbos de perto matam com 1 tiro; a 20 m não fazem nada.
    expect(WEAPON_SHOTGUN.pellets * WEAPON_SHOTGUN.damage).toBeGreaterThanOrEqual(BASE_HP);
    expect(WEAPON_SHOTGUN.minDamage).toBe(0);
    expect(WEAPON_SHOTGUN.falloffEndM).toBe(20);
    expect(WEAPON_KNIFE.fire).toBe(WEAPON_FIRE.melee);
    expect(WEAPON_GRENADE.clipSize).toBe(2);
  });
});

describe('loadout e troca de slot', () => {
  it('nasce com primária, pistola, faca e 2 granadas, munição cheia; a primária vem do SimConfig', () => {
    const { sim } = duel(15, 5, [WEAPON_CODE.smg, WEAPON_CODE.pistol]);
    const v = sim.view();
    const a = entity(sim, 0);
    const b = entity(sim, 1);
    const k = a * WEAPON_SLOT_COUNT;
    expect(Array.from(v.loadout.subarray(k, k + 4))).toEqual([
      WEAPON_CODE.smg,
      WEAPON_CODE.pistol,
      WEAPON_CODE.knife,
      WEAPON_CODE.grenade,
    ]);
    expect(Array.from(v.slotClip.subarray(k, k + 4))).toEqual([30, 12, 0, 2]);
    expect(Array.from(v.slotReserve.subarray(k, k + 4))).toEqual([90, 36, 0, 0]);
    expect(v.weapon[a]).toBe(WEAPON_CODE.smg);
    expect(v.slot[a]).toBe(0);
    // Pistola não é primária: cai no fuzil.
    expect(v.weapon[b]).toBe(WEAPON_CODE.rifle);
  });

  it('troca para o slot pedido em 0,4 s e o evento diz o código da arma', () => {
    const { sim, f } = duel(15, 5);
    const a = entity(sim, 0);
    f[0]!.weapon = WEAPON_SLOT.secondary;
    const switches: number[] = [];
    run(sim, f, 1, (events) => {
      for (const ev of events) if (ev.type === 'weapon' && ev.action === 'switch') switches.push(ev.weapon);
    });
    expect(switches).toEqual([WEAPON_CODE.pistol]);
    expect(sim.view().weapon[a]).toBe(WEAPON_CODE.pistol);
    expect(sim.view().slot[a]).toBe(1);
    // Durante a troca não atira; depois dela, o próximo aperto (a pistola é semi) atira.
    let shots = 0;
    const count = (events: SimEvent[]): void => void (shots += events.filter((e) => e.type === 'shot').length);
    f[0]!.buttons = BUTTON.fire;
    run(sim, f, Math.round(0.3 * SIM_HZ), count);
    expect(shots).toBe(0);
    f[0]!.buttons = 0;
    run(sim, f, Math.round(0.1 * SIM_HZ), count);
    f[0]!.buttons = BUTTON.fire;
    run(sim, f, 1, count);
    expect(shots).toBe(1);
  });

  it('pistola é semiautomática: gatilho preso dá 1 tiro', () => {
    const { sim, f } = duel(15, 5);
    f[0]!.weapon = WEAPON_SLOT.secondary;
    run(sim, f, Math.round(0.5 * SIM_HZ));
    f[0]!.pitch = pitchToI16(0.6);
    f[0]!.buttons = BUTTON.fire;
    let shots = 0;
    run(sim, f, SIM_HZ, (events) => (shots += events.filter((e) => e.type === 'shot').length));
    expect(shots).toBe(1);
  });

  it('a primária do InputFrame vale no próximo spawn', () => {
    const { sim, f } = duel(15, 5);
    run(sim, f, PAST_PROTECTION);
    // O 1 mata o 0 de fuzil; o 0 pediu a escopeta para a próxima vida.
    f[0]!.primary = WEAPON_CODE.shotgun + 1;
    f[1]!.buttons = BUTTON.fire | BUTTON.ads;
    let dead = false;
    run(sim, f, 4 * SIM_HZ, (events) => {
      aimAt(sim, f[1]!, 1, aimPointOf(sim, 0));
      for (const ev of events) if (ev.type === 'kill' && ev.victim === sim.controllerEntity(0)) dead = true;
      if (dead) f[1]!.buttons = 0;
    });
    expect(dead).toBe(true);
    const a = entity(sim, 0);
    expect(sim.view().loadout[a * WEAPON_SLOT_COUNT]).toBe(WEAPON_CODE.shotgun);
    expect(sim.view().weapon[a]).toBe(WEAPON_CODE.shotgun);
  });
});

describe('escopeta', () => {
  it('de perto mata com 1 tiro, num item de dano só (os chumbos somam), com 8 traçadores', () => {
    const { sim, f } = duel(15, 12, [WEAPON_CODE.shotgun]);
    run(sim, f, PAST_PROTECTION);
    aimAt(sim, f[0]!, 0, aimPointOf(sim, 1));
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    let shots = 0;
    const hits: number[] = [];
    let killed = false;
    run(sim, f, 30, (events) => {
      for (const ev of events) {
        if (ev.type === 'shot') shots++;
        if (ev.type === 'hit') hits.push(ev.damage);
        if (ev.type === 'kill') killed = true;
      }
      f[0]!.buttons = BUTTON.ads;
    });
    expect(shots).toBe(WEAPON_SHOTGUN.pellets);
    expect(hits.length).toBe(1);
    expect(hits[0]).toBeGreaterThanOrEqual(BASE_HP);
    expect(killed).toBe(true);
  });

  it('a 30 m os chumbos não fazem dano', () => {
    const { sim, f } = duel(45, 15, [WEAPON_CODE.shotgun]);
    run(sim, f, PAST_PROTECTION);
    aimAt(sim, f[0]!, 0, aimPointOf(sim, 1));
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    let hits = 0;
    run(sim, f, 30, (events) => {
      hits += events.filter((e) => e.type === 'hit').length;
      f[0]!.buttons = BUTTON.ads;
    });
    expect(hits).toBe(0);
  });

  it('recarrega 1 cartucho a cada 0,5 s, e atirar interrompe', () => {
    const { sim, f } = duel(15, 5, [WEAPON_CODE.shotgun]);
    const a = entity(sim, 0);
    f[0]!.pitch = pitchToI16(0.6);
    // Esvazia o pente (6 tiros a 70/min, ~0,86 s cada) apertando e soltando.
    for (let i = 0; i < 6; i++) {
      f[0]!.buttons = BUTTON.fire;
      run(sim, f, 1);
      f[0]!.buttons = 0;
      if (i < 5) run(sim, f, Math.ceil((60 / WEAPON_SHOTGUN.rpm) * SIM_HZ));
    }
    // Pente vazio: a recarga começa sozinha; 2 cartuchos em ~1 s.
    run(sim, f, Math.round(1.05 * SIM_HZ));
    expect(heldClip(sim.view(), a)).toBe(2);
    // Puxar o gatilho com cartucho no pente interrompe a recarga e atira.
    f[0]!.buttons = BUTTON.fire;
    let shots = 0;
    run(sim, f, 2, (events) => (shots += events.filter((e) => e.type === 'shot').length));
    expect(shots).toBe(WEAPON_SHOTGUN.pellets);
    expect(heldClip(sim.view(), a)).toBe(1);
    expect(heldReserve(sim.view(), a)).toBe(WEAPON_SHOTGUN.reserve - 2);
  });
});

describe('faca', () => {
  /** O 0 a 1,2 m atrás (ou de frente) do 1; troca para a faca e golpeia uma vez. */
  function stab(backstab: boolean): number[] {
    const a: MapSpawn = { x: cellCenter(20), y: FLOOR, z: 15, yaw: 0, team: 0 };
    const b: MapSpawn = { x: cellCenter(20), y: FLOOR, z: 13.8, yaw: backstab ? 0 : Math.PI, team: 1 };
    const sim = createSim({ recipe: duelRecipe(), map: flatMap([a, b]), humans: 2 });
    const f = createInputFrames();
    f[1]!.yaw = yawToU16(backstab ? 0 : Math.PI);
    f[0]!.weapon = WEAPON_SLOT.melee;
    run(sim, f, PAST_PROTECTION);
    const hits: number[] = [];
    f[0]!.buttons = BUTTON.fire;
    run(sim, f, 1, (events) => {
      for (const ev of events) if (ev.type === 'hit') hits.push(ev.damage);
    });
    return hits;
  }

  it('de frente tira 55, pelas costas 100', () => {
    expect(stab(false)).toEqual([WEAPON_KNIFE.damage]);
    expect(stab(true)).toEqual([WEAPON_KNIFE.backstabDamage]);
  });
});

describe('ADS e sniper', () => {
  it('o ADS entra em adsInS e a sniper com ADS completo acerta o tronco a 40 m com 95', () => {
    const { sim, f } = duel(55, 15, [WEAPON_CODE.sniper]);
    const a = entity(sim, 0);
    run(sim, f, PAST_PROTECTION);
    aimAt(sim, f[0]!, 0, aimPointOf(sim, 1));
    f[0]!.buttons = BUTTON.ads;
    run(sim, f, Math.ceil(WEAPON_SNIPER.adsInS * SIM_HZ) + 1);
    expect(sim.view().adsAmount[a]).toBe(1);
    f[0]!.buttons = BUTTON.ads | BUTTON.fire;
    const hits: number[] = [];
    run(sim, f, 2, (events) => {
      for (const ev of events) if (ev.type === 'hit') hits.push(ev.damage);
    });
    expect(hits).toEqual([95]);
  });

  it('sem ADS a sniper espalha muito: erra a maior parte a 40 m', () => {
    const { sim, f } = duel(55, 15, [WEAPON_CODE.sniper]);
    run(sim, f, PAST_PROTECTION);
    let hits = 0;
    let shots = 0;
    // 5 tiros do quadril, um a cada 1,4 s (ferrolho a 45/min), sempre mirando no tronco.
    for (let i = 0; i < 5; i++) {
      aimAt(sim, f[0]!, 0, aimPointOf(sim, 1));
      f[0]!.buttons = BUTTON.fire;
      run(sim, f, 1, (events) => {
        for (const ev of events) {
          if (ev.type === 'shot') shots++;
          if (ev.type === 'hit') hits++;
        }
      });
      f[0]!.buttons = 0;
      run(sim, f, Math.ceil(1.4 * SIM_HZ));
    }
    expect(shots).toBe(5);
    expect(hits).toBeLessThanOrEqual(2);
  });
});
