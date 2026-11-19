import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import { i16ToPitch, pitchToI16, u16ToYaw, yawToU16 } from '@boboforces/shared';
import type { MatchPhase, PickupView, ProjectileView, SimRemoteState, SimView } from '@boboforces/sim';

/**
 * O que viaja da sim do host para a do cliente (M5, tecnico.md §13.3): só o que a view mostra (o render, o HUD e o
 * áudio leem a `SimView`), quantizado em inteiros. Posição em 1 cm, ângulos em 16 bits (os mesmos do InputFrame:
 * a mira dos humanos e dos bots volta exata), velocidade em 5 cm/s, vida em 0,1. Os campos internos da sim
 * (cooldowns, botões, RNG) não viajam: o cliente não roda a sim. Campo novo da view entra no FIM do grupo dele (ou num
 * grupo novo no fim) e sobe o `PROTOCOL_VERSION`.
 */

/** Como um inteiro quantizado viaja. `small` > 0: a diferença para a base vai em `small` bits quando cabe. */
export interface NetCodec {
  readonly bits: number;
  readonly signed: boolean;
  readonly small: number;
}

const s = (bits: number, small = 0): NetCodec => ({ bits, signed: true, small });
const u = (bits: number, small = 0): NetCodec => ({ bits, signed: false, small });

/**
 * Limita `q` à faixa do codec. O host guarda o valor já limitado, então o cliente reconstrói exatamente o mesmo
 * inteiro. Sem sinal de 32 bits fica na representação de Int32 (`| 0`); NaN vira 0.
 */
export function fitCodec(q: number, c: NetCodec): number {
  if (c.signed) {
    const max = 2 ** (c.bits - 1) - 1;
    return (q > max ? max : q < -max - 1 ? -max - 1 : q) | 0;
  }
  const max = 2 ** c.bits - 1;
  return (q > max ? max : q < 0 ? 0 : q) | 0;
}

type NumArray = Float64Array | Float32Array | Int32Array | Uint32Array | Int16Array | Uint16Array | Uint8Array;

/** Um campo de um pool (entidades, projéteis ou pickups): `stride` componentes por item, índice plano `i`. */
export interface NetField<V> {
  readonly name: string;
  readonly stride: number;
  readonly codec: NetCodec;
  /** Valor quantizado (ainda sem limitar) do índice plano `i` = item × stride + componente. */
  read(v: V, i: number): number;
  /** Escreve o valor quantizado de volta (cliente). */
  write(v: V, i: number, q: number): void;
  /**
   * Caminho rápido (o laço por campo lê o array direto, sem chamar `read`/`write` por item): o array da view e a
   * escala (0 = inteiro como está; senão arredonda `valor × escala`). `null` = só por `read`/`write` (a mira).
   */
  readonly array: ((v: V) => NumArray) | null;
  readonly scale: number;
}

function fixed<V>(name: string, stride: number, codec: NetCodec, scale: number, arr: (v: V) => NumArray): NetField<V> {
  return {
    name,
    stride,
    codec,
    read: (v, i) => Math.round(arr(v)[i]! * scale),
    write: (v, i, q) => {
      arr(v)[i] = q / scale;
    },
    array: arr,
    scale,
  };
}

function int<V>(name: string, stride: number, codec: NetCodec, arr: (v: V) => NumArray): NetField<V> {
  return {
    name,
    stride,
    codec,
    read: (v, i) => arr(v)[i]!,
    write: (v, i, q) => {
      arr(v)[i] = q;
    },
    array: arr,
    scale: 0,
  };
}

/** Grupo de campos com um bit de "mudou" (dentro dele, um bit por componente). */
export interface FieldGroup<V> {
  readonly name: string;
  readonly fields: readonly NetField<V>[];
}

const W = WEAPON_SLOT_COUNT;

/**
 * Entidades: os 4 primeiros grupos são os "quentes" (mudam quase todo snapshot), com um bit cada; os outros vão atrás
 * de um bit "mudou algo frio".
 */
export const ENTITY_GROUPS: readonly FieldGroup<SimView>[] = [
  { name: 'pos', fields: [fixed('position', 3, s(20, 10), 100, (v) => v.position)] },
  {
    name: 'aim',
    fields: [
      {
        name: 'yaw',
        stride: 1,
        codec: u(16),
        read: (v, i) => yawToU16(v.yaw[i]!),
        write: (v, i, q) => {
          v.yaw[i] = u16ToYaw(q);
        },
        array: null,
        scale: 0,
      },
      {
        name: 'pitch',
        stride: 1,
        codec: s(16),
        read: (v, i) => pitchToI16(v.pitch[i]!),
        write: (v, i, q) => {
          v.pitch[i] = i16ToPitch(q);
        },
        array: null,
        scale: 0,
      },
    ],
  },
  { name: 'vel', fields: [fixed('velocity', 3, s(12, 7), 20, (v) => v.velocity)] },
  {
    name: 'state',
    fields: [int('flags', 1, u(16), (v) => v.flags), fixed('health', 1, u(24, 8), 10, (v) => v.health)],
  },
  {
    name: 'core',
    fields: [
      int('alive', 1, u(1), (v) => v.alive),
      int('generation', 1, u(16), (v) => v.generation),
      int('kind', 1, u(4), (v) => v.kind),
      int('team', 1, u(8), (v) => v.team),
      int('controller', 1, s(16), (v) => v.controller),
    ],
  },
  {
    name: 'hand',
    fields: [
      int('weapon', 1, u(8), (v) => v.weapon),
      int('slot', 1, u(3), (v) => v.slot),
      int('cookTicks', 1, s(16, 4), (v) => v.cookTicks),
      int('quickNade', 1, u(1), (v) => v.quickNade),
      fixed('adsAmount', 1, u(8), 255, (v) => v.adsAmount),
    ],
  },
  {
    name: 'ammo',
    fields: [
      int('loadout', W, u(8), (v) => v.loadout),
      int('slotClip', W, u(16, 4), (v) => v.slotClip),
      int('slotReserve', W, u(16, 6), (v) => v.slotReserve),
    ],
  },
  {
    name: 'score',
    fields: [
      int('kills', 1, u(16, 3), (v) => v.kills),
      int('deaths', 1, u(16, 3), (v) => v.deaths),
      int('assists', 1, u(16, 3), (v) => v.assists),
      int('points', 1, s(32, 12), (v) => v.points),
      int('respawnTicks', 1, s(16, 4), (v) => v.respawnTicks),
    ],
  },
  {
    name: 'recoil',
    fields: [
      fixed('recoilPitch', 1, s(16, 8), 10000, (v) => v.recoilPitch),
      fixed('recoilYaw', 1, s(16, 8), 10000, (v) => v.recoilYaw),
    ],
  },
  { name: 'attacker', fields: [int('lastAttacker', 1, u(32), (v) => v.lastAttacker)] },
  {
    name: 'zombie',
    fields: [
      int('zombieType', 1, u(4), (v) => v.zombieType),
      fixed('bodyScale', 1, u(10), 100, (v) => v.bodyScale),
      int('perks', 1, u(8), (v) => v.perks),
      int('downTicks', 1, s(16, 4), (v) => v.downTicks),
      int('selfUp', 1, u(1), (v) => v.selfUp),
      int('reviveTicks', 1, s(16, 4), (v) => v.reviveTicks),
    ],
  },
];

/** Quantos grupos de entidade são "quentes" (um bit cada, sempre). */
export const HOT_GROUPS = 4;

/** Projéteis em voo (um grupo só). */
export const PROJECTILE_FIELDS: readonly NetField<ProjectileView>[] = [
  int('alive', 1, u(1), (v) => v.alive),
  int('weapon', 1, u(8), (v) => v.weapon),
  int('owner', 1, u(32), (v) => v.owner),
  fixed('position', 3, s(20, 10), 100, (v) => v.position),
  fixed('velocity', 3, s(14, 8), 20, (v) => v.velocity),
];

/** Pickups no chão (um grupo só). */
export const PICKUP_FIELDS: readonly NetField<PickupView>[] = [
  int('alive', 1, u(1), (v) => v.alive),
  int('kind', 1, u(4), (v) => v.kind),
  fixed('position', 3, s(20, 10), 100, (v) => v.position),
  int('ticksLeft', 1, s(16, 6), (v) => v.ticksLeft),
];

/** O que o codificador precisa de cada componente (sem o tipo da view). */
export interface SlotCodecs {
  readonly count: number;
  readonly bits: Int32Array;
  readonly signed: Uint8Array;
  readonly small: Int32Array;
}

/** Componentes achatados de uma lista de campos, para o laço quente (sem closures novas por item). */
export interface SlotTable<V> extends SlotCodecs {
  readonly count: number;
  /** Os campos e o primeiro componente de cada um (o laço por campo). */
  readonly fields: readonly NetField<V>[];
  readonly fieldStart: Int32Array;
  /** Faixa de cada componente (o `fitCodec` sem conta por item). */
  readonly lo: Float64Array;
  readonly hi: Float64Array;
  readonly field: readonly NetField<V>[];
  /** Componente dentro do campo. */
  readonly component: Int32Array;
  readonly bits: Int32Array;
  readonly signed: Uint8Array;
  readonly small: Int32Array;
}

export function slotTable<V>(fields: readonly NetField<V>[]): SlotTable<V> {
  const field: NetField<V>[] = [];
  const comp: number[] = [];
  for (const f of fields) {
    for (let k = 0; k < f.stride; k++) {
      field.push(f);
      comp.push(k);
    }
  }
  const starts: number[] = [];
  let n = 0;
  for (const f of fields) {
    starts.push(n);
    n += f.stride;
  }
  return {
    count: field.length,
    fields,
    fieldStart: Int32Array.from(starts),
    lo: Float64Array.from(field, (f) => (f.codec.signed ? -(2 ** (f.codec.bits - 1)) : 0)),
    hi: Float64Array.from(field, (f) => (f.codec.signed ? 2 ** (f.codec.bits - 1) - 1 : 2 ** f.codec.bits - 1)),
    field,
    component: Int32Array.from(comp),
    bits: Int32Array.from(field, (f) => f.codec.bits),
    signed: Uint8Array.from(field, (f) => (f.codec.signed ? 1 : 0)),
    small: Int32Array.from(field, (f) => f.codec.small),
  };
}

export const ENTITY_SLOTS = slotTable(ENTITY_GROUPS.flatMap((g) => g.fields));
/** Primeiro componente de cada grupo de entidade (e o total no fim). */
export const ENTITY_GROUP_START: Int32Array = (() => {
  const out = new Int32Array(ENTITY_GROUPS.length + 1);
  let n = 0;
  ENTITY_GROUPS.forEach((g, i) => {
    out[i] = n;
    for (const f of g.fields) n += f.stride;
  });
  out[ENTITY_GROUPS.length] = n;
  return out;
})();
export const PROJECTILE_SLOTS = slotTable(PROJECTILE_FIELDS);
export const PICKUP_SLOTS = slotTable(PICKUP_FIELDS);

const PHASES: readonly MatchPhase[] = ['warmup', 'playing', 'ended', 'suddenDeath'];

/** Um escalar da partida ou de um objeto do mapa (o placar, as tábuas, a Caixa). */
export interface GlobalSlot {
  readonly name: string;
  readonly codec: NetCodec;
  read(v: SimView): number;
  /** Cliente: no estado remoto (escalares) ou direto nos arrays da view (placar, objetos do mapa). */
  write(v: SimView, st: SimRemoteState, q: number): void;
}

/** O que a partida manda além das entidades. Depende do mapa (quantas janelas e portas, se tem a Caixa). */
export interface NetLayout {
  readonly globals: readonly GlobalSlot[];
  readonly globalCodecs: SlotTable<SimView>;
}

function g(name: string, codec: NetCodec, read: GlobalSlot['read'], write: GlobalSlot['write']): GlobalSlot {
  return { name, codec, read, write };
}

/** Monta o layout a partir da view (host e cliente criam a sim com a mesma receita e o mesmo mapa: dá o mesmo). */
export function createNetLayout(view: SimView): NetLayout {
  const globals: GlobalSlot[] = [
    g(
      'phase',
      u(2),
      (v) => PHASES.indexOf(v.match.phase),
      (_v, st, q) => {
        st.phase = PHASES[q] ?? 'playing';
      },
    ),
    g(
      'ticksLeft',
      s(24, 6),
      (v) => v.match.ticksLeft,
      (_v, st, q) => {
        st.ticksLeft = q;
      },
    ),
    g(
      'countdownTicks',
      s(16, 6),
      (v) => v.match.countdownTicks,
      (_v, st, q) => {
        st.countdownTicks = q;
      },
    ),
  ];
  for (let t = 0; t < view.match.teamScore.length; t++) {
    globals.push(
      g(
        `teamScore${t}`,
        s(24, 4),
        (v) => v.match.teamScore[t]!,
        (v, _st, q) => {
          v.match.teamScore[t] = q;
        },
      ),
    );
  }
  globals.push(
    g(
      'winnerTeam',
      s(8),
      (v) => v.match.winnerTeam,
      (_v, st, q) => {
        st.winnerTeam = q;
      },
    ),
    g(
      'winnerEntity',
      u(32),
      (v) => v.match.winnerEntity,
      (_v, st, q) => {
        st.winnerEntity = q >>> 0;
      },
    ),
    g(
      'zombieWave',
      u(16),
      (v) => v.match.zombieWave,
      (_v, st, q) => {
        st.zombieWave = q;
      },
    ),
    g(
      'zombiesLeft',
      u(16, 4),
      (v) => v.match.zombiesLeft,
      (_v, st, q) => {
        st.zombiesLeft = q;
      },
    ),
    g(
      'zombieRestTicks',
      s(24, 6),
      (v) => v.match.zombieRestTicks,
      (_v, st, q) => {
        st.zombieRestTicks = q;
      },
    ),
    g(
      'doublePointsTicks',
      s(24, 6),
      (v) => v.match.doublePointsTicks,
      (_v, st, q) => {
        st.doublePointsTicks = q;
      },
    ),
    g(
      'instaKillTicks',
      s(24, 6),
      (v) => v.match.instaKillTicks,
      (_v, st, q) => {
        st.instaKillTicks = q;
      },
    ),
    g(
      'lastZombie',
      u(32),
      (v) => v.match.lastZombie,
      (_v, st, q) => {
        st.lastZombie = q >>> 0;
      },
    ),
    g(
      'selfRevivesLeft',
      s(16),
      (v) => v.match.selfRevivesLeft,
      (_v, st, q) => {
        st.selfRevivesLeft = q;
      },
    ),
  );
  const mo = view.mapObjects;
  if (mo !== null) {
    for (let b = 0; b < mo.barricades; b++) {
      globals.push(
        g(
          `planks${b}`,
          u(3),
          (v) => v.mapObjects!.planks[b]!,
          (v, _st, q) => {
            v.mapObjects!.planks[b] = q;
          },
        ),
      );
    }
    for (let d = 0; d < mo.doors; d++) {
      globals.push(
        g(
          `door${d}`,
          u(1),
          (v) => v.mapObjects!.doorOpen[d]!,
          (v, _st, q) => {
            v.mapObjects!.doorOpen[d] = q;
          },
        ),
      );
    }
    if (mo.boxSpots > 0) {
      for (let k = 0; k < mo.boxState.length; k++) {
        globals.push(
          g(
            `box${k}`,
            s(24, 6),
            (v) => v.mapObjects!.boxState[k]!,
            (v, _st, q) => {
              v.mapObjects!.boxState[k] = q;
            },
          ),
        );
      }
      globals.push(
        g(
          'boxUser',
          u(32),
          (v) => v.mapObjects!.boxUser[0]!,
          (v, _st, q) => {
            v.mapObjects!.boxUser[0] = q;
          },
        ),
      );
    }
  }
  // M6 (fase 1): os pontos do Domination (o dono e o progresso, em milésimos), só no modo dele.
  const cp = view.controlPoints;
  if (cp !== null) {
    for (let i = 0; i < cp.count; i++) {
      globals.push(
        g(
          `point${i}Owner`,
          s(3),
          (v) => v.controlPoints!.owner[i]!,
          (v, _st, q) => {
            v.controlPoints!.owner[i] = q;
          },
        ),
        g(
          `point${i}Progress`,
          s(12, 6),
          (v) => Math.round(v.controlPoints!.progress[i]! * 1000),
          (v, _st, q) => {
            v.controlPoints!.progress[i] = q / 1000;
          },
        ),
      );
    }
  }
  // M6 (fase 6a): a vida do gerador do Fortress (inteira), só nele.
  if (view.fortress !== null) {
    globals.push(
      g(
        'fortressHp',
        u(16, 8),
        (v) => Math.max(0, Math.round(v.fortress!.hp[0]!)),
        (v, _st, q) => {
          v.fortress!.hp[0] = q;
        },
      ),
    );
  }
  // M7 (fase 0): as rodadas (a rodada, a fase, os ticks na fase, as vitórias, os lados e o vencedor), só nelas.
  if (view.rounds !== null) {
    const codecs = [u(8), u(2), u(16, 8), u(8), u(8), u(1), s(3)] as const;
    const names = ['round', 'roundPhase', 'roundTicks', 'roundWins0', 'roundWins1', 'roundSwapped', 'roundWinner'];
    codecs.forEach((codec, i) => {
      globals.push(
        g(
          names[i]!,
          codec,
          (v) => v.rounds!.data[i]!,
          (v, _st, q) => {
            v.rounds!.data[i] = q;
          },
        ),
      );
    });
  }
  // M6 (fase 4): os modificadores (a máscara ligada, a da próxima troca e os ticks até ela), só com eles.
  if (view.chaos !== null) {
    const names = ['chaosActive', 'chaosNext', 'chaosLeft'] as const;
    names.forEach((name, i) => {
      globals.push(
        g(
          name,
          i < 2 ? u(16) : s(16, 8),
          (v) => v.chaos!.masks[i]!,
          (v, _st, q) => {
            v.chaos!.masks[i] = q;
          },
        ),
      );
    });
  }
  // A tabela de codecs dos globais reaproveita o formato das outras (campo = um escalar).
  const asFields: NetField<SimView>[] = globals.map((gs) => ({
    name: gs.name,
    stride: 1,
    codec: gs.codec,
    read: (v) => gs.read(v),
    write: () => undefined,
    array: null,
    scale: 0,
  }));
  return { globals, globalCodecs: slotTable(asFields) };
}

/** Bits para um índice em [0, n). */
export function bitsFor(n: number): number {
  let b = 0;
  while (2 ** b < n) b++;
  return b;
}
