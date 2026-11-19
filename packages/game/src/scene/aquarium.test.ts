import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { ENTITY_FLAG, ENTITY_KIND, expandRecipe, type SimView } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import {
  AQUARIUM_CAMERA,
  aquariumMaxSpeed,
  aquariumSpeedText,
  nextAquariumCamera,
  nextAquariumSpeed,
  nextLivingBobo,
  spectateRecipe,
  stepFlyCamera,
} from './aquarium.ts';

const normal = builtinBotRef('normal');
const chill = builtinBotRef('chill');

function recipe(teams: MatchRecipe['teams'], mode = 'warfare.tdm'): MatchRecipe {
  return { format: MATCH_RECIPE_FORMAT, mode, map: 'construto', seed: 1, teams };
}

describe('Aquário: a receita só de bots', () => {
  it('o lugar do jogador vira um bot do mesmo time (os times ficam do mesmo tamanho)', () => {
    const r = spectateRecipe(
      recipe([{ humans: 'all', bots: [{ ref: chill, count: 3 }] }, { bots: [{ ref: normal, count: 4 }] }]),
      normal,
    );
    const slots = expandRecipe(r, 0);
    expect(slots.filter((s) => s.bot === null)).toHaveLength(0);
    expect(slots.filter((s) => s.team === 0)).toHaveLength(4);
    expect(slots.filter((s) => s.team === 1)).toHaveLength(4);
    // O bot novo é como os outros do time (aqui, o Chill).
    expect(r.teams[0]!.bots[0]).toEqual({ ref: chill, count: 1 });
    expect(r.teams[0]!.humans).toBeUndefined();
  });

  it('sem bot no time, o bot do pedido; o Royale continua com 24', () => {
    const z = spectateRecipe(recipe([{ humans: 'all', bots: [] }], 'zombies'), normal);
    expect(z.teams[0]!.bots).toEqual([{ ref: normal, count: 1 }]);
    const royale = spectateRecipe(
      recipe([{ humans: 'all', bots: [{ ref: normal, count: 23 }] }], 'royale.mini'),
      chill,
    );
    expect(expandRecipe(royale, 0)).toHaveLength(24);
  });

  it('sem `humans` em time nenhum, o jogador ia para o time 0: o bot também', () => {
    const r = spectateRecipe(
      recipe([{ bots: [{ ref: chill, count: 2 }] }, { bots: [{ ref: normal, count: 3 }] }]),
      normal,
    );
    expect(expandRecipe(r, 0).filter((s) => s.team === 0)).toHaveLength(3);
  });
});

describe('Aquário: a velocidade e as câmeras', () => {
  it('4× no PC, 2× no celular e no Switch; o aperto passa para a próxima e dá a volta no teto', () => {
    expect(aquariumMaxSpeed('pc')).toBe(4);
    expect(aquariumMaxSpeed('switch')).toBe(2);
    expect(aquariumMaxSpeed('mobile')).toBe(2);
    expect(nextAquariumSpeed(1, 4)).toBe(2);
    expect(nextAquariumSpeed(2, 4)).toBe(4);
    expect(nextAquariumSpeed(4, 4)).toBe(0.25);
    expect(nextAquariumSpeed(2, 2)).toBe(0.25);
    expect(nextAquariumSpeed(0.25, 2)).toBe(0.5);
    expect(aquariumSpeedText(0.25)).toBe('0,25×');
    expect(aquariumSpeedText(4)).toBe('4×');
  });

  it('a câmera troca seguir → olhos → livre → de cima → seguir', () => {
    let c = AQUARIUM_CAMERA.follow as number;
    const seen: number[] = [];
    for (let k = 0; k < 4; k++) {
      c = nextAquariumCamera(c as 0);
      seen.push(c);
    }
    expect(seen).toEqual([AQUARIUM_CAMERA.eyes, AQUARIUM_CAMERA.free, AQUARIUM_CAMERA.top, AQUARIUM_CAMERA.follow]);
  });

  it('a câmera livre anda na direção do olhar e para nos limites', () => {
    const cam = { x: 0, y: 10, z: 0 };
    const b = { minX: -5, maxX: 5, minY: 1, maxY: 20, minZ: -50, maxZ: 50 };
    // Yaw 0 olha para −Z; 1 s para a frente a 12 m/s.
    stepFlyCamera(cam, 0, 0, 0, 1, 0, false, 1, b);
    expect(cam.z).toBeCloseTo(-12);
    expect(cam.x).toBeCloseTo(0);
    // De lado (+X) bate no limite; subindo correndo também.
    stepFlyCamera(cam, 0, 0, 1, 0, 1, true, 1, b);
    expect(cam.x).toBe(5);
    expect(cam.y).toBe(20);
  });
});

describe('Aquário: o próximo bobo vivo', () => {
  // 0 vivo, 1 morto, 2 zumbi, 3 vivo, 4 vazio.
  const view = {
    count: 5,
    alive: Uint8Array.from([1, 1, 1, 1, 0]),
    kind: Uint8Array.from([ENTITY_KIND.bobo, ENTITY_KIND.bobo, ENTITY_KIND.zombie, ENTITY_KIND.bobo, ENTITY_KIND.bobo]),
    flags: Uint16Array.from([0, ENTITY_FLAG.dead, 0, 0, 0]),
  } as unknown as SimView;

  it('pula mortos, zumbis e vazios, nas duas direções, dando a volta', () => {
    expect(nextLivingBobo(view, 0, 1)).toBe(3);
    expect(nextLivingBobo(view, 3, 1)).toBe(0);
    expect(nextLivingBobo(view, 0, -1)).toBe(3);
    expect(nextLivingBobo(view, -1, 1)).toBe(0);
    expect(nextLivingBobo(view, 1, 1)).toBe(3);
  });

  it('só um vivo: fica nele; nenhum: -1', () => {
    const one = { ...view, alive: Uint8Array.from([1, 0, 0, 0, 0]) } as unknown as SimView;
    expect(nextLivingBobo(one, 0, 1)).toBe(0);
    const none = { ...view, alive: new Uint8Array(5) } as unknown as SimView;
    expect(nextLivingBobo(none, 0, 1)).toBe(-1);
  });
});
