import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis } from '@boboforces/input';
import { createInputFrames, createSim, ENTITY_FLAG, entityIndex, MOVEMENT_BOBO, SIM_HZ } from '@boboforces/sim';
import { BLOCK_SIZE, createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { jumpProfile, jumpTravelM, supportGap, type JumpProfile } from './jump-reach.ts';

/**
 * M10 (fase 1c): o alcance do pulo correndo do `mapc` (`jumpTravelM`) contra a sim de verdade: dois blocos com um vão
 * entre as bordas, o bobo corre (sprint) para fora da borda do primeiro e pula no fim do coyote (ou na borda, para a
 * subida que só o ápice alcança). O vão que a conta diz que dá (arredondado para baixo à célula) precisa dar; 1 m a
 * mais, não. Também na gravidade da Lua (`SimMap.gravity`, a Estação Lunar).
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const EDGE_Z = 60;
const TOP_A = 4.5;
const MOON = 0.35;

/**
 * Pula de A (topo a 4,5 m, borda em z = 60 m) para B (topo `rise` m acima, borda `gap` m adiante em −Z). Pousou em B?
 * `edge`: pula no último tick com chão (sem coyote); senão, no último tick do coyote.
 */
function leap(gap: number, rise: number, gravity = 1, edge = false): boolean {
  const grid = createWorldGrid(16, 40, 160);
  fillBox(grid, 0, 0, 0, 15, 0, 159, concrete);
  const edgeCell = EDGE_Z / BLOCK_SIZE;
  fillBox(grid, 0, 1, edgeCell, 15, TOP_A / BLOCK_SIZE - 1, 159, concrete);
  fillBox(grid, 0, 1, 0, 15, (TOP_A + rise) / BLOCK_SIZE - 1, edgeCell - gap / BLOCK_SIZE - 1, concrete);
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 1,
    teams: [{ humans: 1, bots: [] }],
  };
  const spawns = [{ x: 4, y: TOP_A, z: EDGE_Z + 6, yaw: 0, team: 0 }];
  const sim = createSim({
    recipe,
    map: { grid, blocks, spawns, ...(gravity !== 1 ? { gravity } : {}) },
    humans: 1,
    hz: SIM_HZ,
  });
  const frames = createInputFrames();
  const frame = frames[0]!;
  const e = entityIndex(sim.controllerEntity(0));
  const v = sim.view();
  const coyote = Math.round(MOVEMENT_BOBO.coyoteS * SIM_HZ);
  // O apoio acaba quando a caixa (0,3 m de meia largura) passa da borda; um tick a correr anda sprint / hz.
  const leaveZ = EDGE_Z - 0.3 + MOVEMENT_BOBO.sprint / SIM_HZ;
  let air = 0;
  let jumped = false;
  let landed = false;
  for (let t = 0; t < 6 * SIM_HZ && !landed; t++) {
    const z0 = v.position[e * 3 + 2]!;
    const jump = !jumped && (edge ? z0 <= leaveZ : air === coyote);
    frame.moveY = quantizeAxis(1);
    frame.buttons = BUTTON.sprint | (jump ? BUTTON.jump : 0);
    if (jump) jumped = true;
    sim.step(frames);
    const onGround = (v.flags[e]! & ENTITY_FLAG.onGround) !== 0;
    if (!jumped) air = onGround ? 0 : air + 1;
    const y = v.position[e * 3 + 1]!;
    const z = v.position[e * 3 + 2]!;
    // Pousou em B: na altura dele e com a caixa já do lado de lá da borda.
    if (jumped && onGround) landed = Math.abs(y - (TOP_A + rise)) < 0.01 && z < EDGE_Z - gap + 0.31;
    if (jumped && onGround && !landed) break;
  }
  sim.dispose();
  return landed;
}

/** O maior vão (m, à célula) que a conta dá, com 0,25 m de folga. */
function okGap(j: JumpProfile, rise: number): number {
  return Math.floor((jumpTravelM(j, rise) + 2 * j.radius - 0.25) / BLOCK_SIZE) * BLOCK_SIZE;
}

describe('alcance do pulo correndo (mapc) contra a sim', () => {
  const j = jumpProfile();
  it.each([0, 0.5, 1, -2])('subida de %d m: o vão da conta dá; 1 m a mais, não', (rise) => {
    const ok = okGap(j, rise);
    expect(ok).toBeGreaterThan(2);
    expect(leap(ok, rise)).toBe(true);
    expect(leap(ok + 1, rise)).toBe(false);
  });

  it('a escalada no ar: 1,5 m acima pulando na borda dá; acima do pulo + escalada, a conta não tem alcance', () => {
    expect(leap(okGap(j, 1.5), 1.5, 1, true)).toBe(true);
    expect(leap(okGap(j, 1.5) + 1, 1.5, 1, true)).toBe(false);
    expect(jumpTravelM(j, j.jumpHeight + j.airStep + 0.1)).toBe(-1);
  });

  it('na gravidade da Lua (0,35) o pulo vai muito mais longe e mais alto, e a conta acompanha a sim', () => {
    const moon = jumpProfile(MOVEMENT_BOBO, MOON);
    expect(moon.jumpHeight).toBeCloseTo(1 / MOON, 9);
    for (const rise of [0, 2]) {
      const ok = okGap(moon, rise);
      expect(ok).toBeGreaterThan(okGap(j, 0) + 4);
      expect(leap(ok, rise, MOON)).toBe(true);
      expect(leap(ok + 1, rise, MOON)).toBe(false);
    }
  });

  it('o vão entre os quadrados de apoio de dois nós desconta o nó e a caixa dos dois lados', () => {
    expect(supportGap(1, 0, 0.3)).toBe(0);
    expect(supportGap(5, 0, 0.3)).toBeCloseTo(3.4, 9);
    expect(supportGap(3, 4, 0)).toBeCloseTo(Math.hypot(2, 3), 9);
  });
});
