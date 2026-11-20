import { createHeadlessMatch } from '@boboforces/ai';
import {
  builtinBotRef,
  createFigureGameTable,
  MATCH_RECIPE_FORMAT,
  type BotLevel,
  type FigureGameTable,
  type MatchRecipe,
} from '@boboforces/format';
import {
  ARSENAL,
  BASE_HP,
  BOT_CONTROLLER_BASE,
  MAX_CONTROLLERS,
  SIM_HZ,
  WEAPON_CODE,
  WEAPON_FIRE,
  WEAPON_SLOT,
  weaponDamageAt,
  weaponDef,
  type SimMap,
  type WeaponDef,
} from '@boboforces/sim';
import { buildDuelMap } from './duel.ts';

/**
 * M10 (fases 6 e 7): o robô por arma (GDD §4.3; gameplay.md §6.13: "TTK de cada par de armas e os multiplicadores de
 * headshot"). Para cada arma de fogo do arsenal: a conta do TTK sem errar (tiros para matar no corpo e na cabeça, a
 * cadência, o pente de 1 da besta) conferida contra a faixa da classe dela, e duelos de bots iguais com a arma, na
 * distância da classe, que medem o TTK de verdade (do 1º acerto no inimigo à morte), a precisão e os tiros na cabeça.
 */

/** A classe de cada arma no relatório (a faixa do TTK teórico que ela tem que cumprir). */
export type WeaponClass = 'auto' | 'secondary' | 'shotgun' | 'precision' | 'explosive';

/**
 * As faixas (GDD §4.3): automáticas 0,28–0,45 s no corpo (o fuzil 0,30, a SMG 0,28; o DMR, semiautomático, entra na
 * do fuzil); a secundária perto dos 0,45 s da pistola (até 0,55: o revólver é lento de propósito); as escopetas matam
 * de perto em até 2 tiros; as de precisão em 2 no corpo e 1 na cabeça; os explosivos em até 2 acertos diretos.
 */
export const WEAPON_CLASS_BANDS = {
  auto: { minS: 0.28, maxS: 0.45 },
  secondary: { minS: 0.4, maxS: 0.55 },
  shotgunMaxShots: 2,
  precision: { body: 2, head: 1 },
  explosiveMaxHits: 2,
} as const;

/** Arma, classe e a distância do duelo (m). Nomes em inglês bobo (a ferramenta não usa a tabela de textos do jogo). */
export const WEAPON_TABLE: readonly {
  readonly code: number;
  readonly name: string;
  readonly cls: WeaponClass;
  readonly distanceM: number;
}[] = [
  { code: WEAPON_CODE.rifle, name: 'Rattler', cls: 'auto', distanceM: 20 },
  { code: WEAPON_CODE.smg, name: 'Buzzer', cls: 'auto', distanceM: 10 },
  { code: WEAPON_CODE.lmg, name: 'Lawnmower', cls: 'auto', distanceM: 20 },
  { code: WEAPON_CODE.dmr, name: 'Pinpoint', cls: 'auto', distanceM: 30 },
  { code: WEAPON_CODE.autoShotgun, name: 'Leafblower', cls: 'auto', distanceM: 6 },
  { code: WEAPON_CODE.shotgun, name: 'Door Knocker', cls: 'shotgun', distanceM: 6 },
  { code: WEAPON_CODE.pistol, name: 'Pop Gun', cls: 'secondary', distanceM: 12 },
  { code: WEAPON_CODE.revolver, name: 'Hand Cannon', cls: 'secondary', distanceM: 12 },
  { code: WEAPON_CODE.sniper, name: 'Peekaboo', cls: 'precision', distanceM: 40 },
  { code: WEAPON_CODE.crossbow, name: 'Twang', cls: 'precision', distanceM: 25 },
  { code: WEAPON_CODE.rocket, name: 'Kaboomer', cls: 'explosive', distanceM: 20 },
  { code: WEAPON_CODE.grenadeLauncher, name: 'Bloop', cls: 'explosive', distanceM: 16 },
];

export interface WeaponTheory {
  /** Dano de um disparo no tronco de perto (os chumbos somados; o acerto direto no explosivo). */
  readonly perShot: number;
  readonly bodyShots: number;
  readonly headShots: number;
  /** Intervalo entre disparos (s): a cadência, ou a recarga no pente de 1 (a besta). */
  readonly intervalS: number;
  readonly ttkBodyS: number;
  readonly ttkHeadS: number;
}

/** TTK sem errar, de perto, com o dano cheio (GDD §4.3: "TTK sem errar no corpo"). */
export function weaponTheory(def: WeaponDef): WeaponTheory {
  const perShot = def.fire === WEAPON_FIRE.pellets ? def.pellets * weaponDamageAt(def, 0) : def.damage;
  const headMul = def.fire === WEAPON_FIRE.projectile ? 1 : def.headMultiplier;
  const bodyShots = Math.ceil(BASE_HP / perShot);
  const headShots = Math.ceil(BASE_HP / (perShot * headMul));
  const intervalS = def.clipSize === 1 ? Math.max(60 / def.rpm, def.reloadS) : 60 / def.rpm;
  return {
    perShot,
    bodyShots,
    headShots,
    intervalS,
    ttkBodyS: (bodyShots - 1) * intervalS,
    ttkHeadS: (headShots - 1) * intervalS,
  };
}

/** A conta da arma cabe na faixa da classe? Devolve o problema, ou `null`. */
export function classProblem(cls: WeaponClass, t: WeaponTheory): string | null {
  const b = WEAPON_CLASS_BANDS;
  const out = (what: string): string => `fora da faixa (${cls}): ${what}`;
  switch (cls) {
    case 'auto':
    case 'secondary': {
      const band = b[cls];
      return t.ttkBodyS < band.minS - 1e-9 || t.ttkBodyS > band.maxS + 1e-9
        ? out(`TTK ${t.ttkBodyS.toFixed(2)} s fora de ${band.minS}–${band.maxS} s`)
        : null;
    }
    case 'shotgun':
      return t.bodyShots > b.shotgunMaxShots ? out(`${t.bodyShots} tiros de perto`) : null;
    case 'precision':
      return t.bodyShots !== b.precision.body || t.headShots !== b.precision.head
        ? out(`${t.bodyShots}/${t.headShots} tiros (corpo/cabeça)`)
        : null;
    case 'explosive':
      return t.bodyShots > b.explosiveMaxHits ? out(`${t.bodyShots} acertos diretos`) : null;
  }
}

export interface WeaponRow {
  readonly code: number;
  readonly name: string;
  readonly cls: WeaponClass;
  readonly distanceM: number;
  readonly theory: WeaponTheory;
  rounds: number;
  /** Duelos que acabaram com uma morte pela arma (o resto: empate, ou morte por outra arma). */
  decided: number;
  ttkSum: number;
  ttkCount: number;
  headshots: number;
  pulls: number;
  hits: number;
}

export interface WeaponReport {
  readonly rows: readonly WeaponRow[];
  readonly level: BotLevel;
  readonly problems: readonly string[];
  readonly ok: boolean;
}

export interface WeaponDuelOptions {
  readonly roundsPerWeapon: number;
  readonly seed: number;
  /** Nível dos dois bots (padrão: Tryhard, a mira mais firme mede melhor a arma). */
  readonly level?: BotLevel;
  /** Só estas armas (códigos); padrão: a tabela inteira. */
  readonly codes?: readonly number[];
  readonly maxRoundS?: number;
  readonly figureTable?: FigureGameTable;
}

interface WeaponRound {
  winner: number;
  ttk: number;
  headshot: boolean;
  pulls: number;
  hits: number;
}

/** Um duelo com a arma `code` dos dois lados (a secundária pelas armas permitidas: só ela no loadout). */
function weaponRound(
  code: number,
  level: BotLevel,
  map: SimMap,
  seed: number,
  maxTicks: number,
  figureTable: FigureGameTable,
): WeaponRound {
  const def = weaponDef(code)!;
  const secondary = def.slot === WEAPON_SLOT.secondary;
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'duel',
    seed,
    teams: [{ bots: [{ ref: builtinBotRef(level), count: 1 }] }, { bots: [{ ref: builtinBotRef(level), count: 1 }] }],
    // A primária sozinha (sem pistola, faca nem granada): o duelo mede só a arma. A secundária, só ela.
    weapons: { allowed: [def.id] },
  };
  const primaries = new Array<number>(MAX_CONTROLLERS).fill(secondary ? WEAPON_CODE.rifle : code);
  const out: WeaponRound = { winner: -1, ttk: Number.NaN, headshot: false, pulls: 0, hits: 0 };
  const firstHit = [-1, -1];
  const lastPull = [-1, -1];
  let done = false;
  let ids: readonly [number, number] = [0, 0];
  const side = (id: number): number => (id === ids[0] ? 0 : id === ids[1] ? 1 : -1);
  const match = createHeadlessMatch({
    recipe,
    map,
    humans: 0,
    figureTable,
    primaries,
    onEvents: (events) => {
      for (const ev of events) {
        if (ev.type === 'shot' || (ev.type === 'projectile' && ev.action === 'launch')) {
          const s = side(ev.type === 'shot' ? ev.shooter : ev.owner);
          // Os chumbos saem no mesmo tick: um disparo.
          if (s >= 0 && lastPull[s] !== ev.tick) {
            lastPull[s] = ev.tick;
            out.pulls++;
          }
        } else if (ev.type === 'hit' && ev.damage > 0 && ev.target !== ev.shooter) {
          const s = side(ev.shooter);
          if (s >= 0) {
            out.hits++;
            if (firstHit[s] === -1) firstHit[s] = ev.tick;
          }
        } else if (ev.type === 'kill' && !done) {
          done = true;
          const s = side(ev.killer);
          if (s >= 0 && ev.weapon === code && ev.killer !== ev.victim) {
            out.winner = s;
            out.headshot = ev.headshot;
            out.ttk = (ev.tick - firstHit[s]!) / SIM_HZ;
          }
        }
      }
    },
  });
  ids = [match.sim.controllerEntity(BOT_CONTROLLER_BASE), match.sim.controllerEntity(BOT_CONTROLLER_BASE + 1)];
  for (let t = 0; t < maxTicks && !done; t++) match.step();
  match.dispose();
  return out;
}

/** O relatório por arma. Determinístico para a mesma semente. */
export function runWeaponDuels(options: WeaponDuelOptions): WeaponReport {
  const level = options.level ?? 'tryhard';
  const maxTicks = Math.round((options.maxRoundS ?? 15) * SIM_HZ);
  const figureTable = options.figureTable ?? createFigureGameTable();
  const table = options.codes ? WEAPON_TABLE.filter((w) => options.codes!.includes(w.code)) : WEAPON_TABLE;
  const maps = new Map<number, SimMap>();
  const rows: WeaponRow[] = [];
  const problems: string[] = [];
  for (const w of table) {
    const def = weaponDef(w.code)!;
    const theory = weaponTheory(def);
    const problem = classProblem(w.cls, theory);
    if (problem !== null) problems.push(`${w.name}: ${problem}`);
    let map = maps.get(w.distanceM);
    if (!map) {
      map = buildDuelMap(w.distanceM);
      maps.set(w.distanceM, map);
    }
    const row: WeaponRow = {
      code: w.code,
      name: w.name,
      cls: w.cls,
      distanceM: w.distanceM,
      theory,
      rounds: 0,
      decided: 0,
      ttkSum: 0,
      ttkCount: 0,
      headshots: 0,
      pulls: 0,
      hits: 0,
    };
    for (let r = 0; r < options.roundsPerWeapon; r++) {
      const seed = (options.seed * 1_000_003 + w.code * 100_003 + r) >>> 0;
      const res = weaponRound(w.code, level, map, seed, maxTicks, figureTable);
      row.rounds++;
      row.pulls += res.pulls;
      row.hits += res.hits;
      if (res.winner < 0) continue;
      row.decided++;
      if (res.headshot) row.headshots++;
      if (Number.isFinite(res.ttk)) {
        row.ttkSum += res.ttk;
        row.ttkCount++;
      }
    }
    rows.push(row);
  }
  for (const id of ARSENAL) {
    const fire = id.fire === WEAPON_FIRE.melee || id.fire === WEAPON_FIRE.thrown;
    if (!fire && !WEAPON_TABLE.some((w) => w.code === id.code)) problems.push(`${id.id}: arma de fogo fora da tabela`);
  }
  return { rows, level, problems, ok: problems.length === 0 };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function padLeft(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

const CLASS_NAMES: Readonly<Record<WeaponClass, string>> = {
  auto: 'automática',
  secondary: 'secundária',
  shotgun: 'escopeta',
  precision: 'precisão',
  explosive: 'explosivo',
};

export function formatWeaponReport(r: WeaponReport): string {
  const lines: string[] = [];
  const n = r.rows[0]?.rounds ?? 0;
  lines.push(`Robô de balanceamento: as armas (${r.level} × ${r.level}, ${n} duelos cada, só a arma no loadout)`);
  lines.push('');
  lines.push(
    `${pad('Arma', 13)}${pad('Classe', 12)}${padLeft('Dist', 5)}${padLeft('Tiros c/cab', 12)}${padLeft('TTK teórico', 16)}${padLeft('TTK medido', 12)}${padLeft('Decididos', 11)}${padLeft('Precisão', 10)}${padLeft('HS', 6)}`,
  );
  for (const w of r.rows) {
    const t = w.theory;
    const ttk = w.ttkCount > 0 ? `${(w.ttkSum / w.ttkCount).toFixed(2)} s` : '—';
    const prec = w.pulls > 0 ? `${((w.hits / w.pulls) * 100).toFixed(0)}%` : '—';
    const hs = w.decided > 0 ? `${((w.headshots / w.decided) * 100).toFixed(0)}%` : '—';
    lines.push(
      `${pad(w.name, 13)}${pad(CLASS_NAMES[w.cls], 12)}${padLeft(`${w.distanceM} m`, 5)}${padLeft(`${t.bodyShots}/${t.headShots}`, 12)}${padLeft(`${t.ttkBodyS.toFixed(2)}/${t.ttkHeadS.toFixed(2)} s`, 16)}${padLeft(ttk, 12)}${padLeft(`${w.decided}/${w.rounds}`, 11)}${padLeft(prec, 10)}${padLeft(hs, 6)}`,
    );
  }
  lines.push('');
  lines.push(
    'TTK teórico: sem errar, de perto (corpo/cabeça). TTK medido: do 1º acerto no inimigo à morte, nos duelos decididos.',
  );
  lines.push(r.ok ? 'OK: toda arma na faixa da classe dela.' : `FALHOU:\n  ${r.problems.join('\n  ')}`);
  return lines.join('\n');
}
