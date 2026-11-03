import { describe, expect, it } from 'vitest';
import { HITBOXES, METRICS } from './config/metrics.ts';
import { weaponDamageAt, WEAPON_RIFLE } from './config/weapons.ts';
import { ENTITY_FLAG } from './entity.ts';
import { aimPointHeight, createBoboHit, eyeHeightFor, rayVsBobo } from './hitbox.ts';

const out = createBoboHit();

/** Raio horizontal vindo de +Z (olhando para -Z) na altura `y`, deslocado `x` para o lado. */
function shootFromFront(y: number, x = 0, yaw = 0, crouched = false): number {
  const t = rayVsBobo(0, 0, 0, yaw, crouched, x, y, 10, 0, 0, -1, 100, out);
  return t === Infinity ? -1 : out.part;
}

describe('hitboxes do bobo', () => {
  it('cabeça, tronco, braço e perna em pé', () => {
    expect(shootFromFront(1.25)).toBe(0);
    expect(shootFromFront(0.75)).toBe(1);
    expect(shootFromFront(0.75, 0.3)).toBe(2);
    expect(shootFromFront(0.25, 0.1)).toBe(3);
    expect(shootFromFront(1.6)).toBe(-1);
    expect(shootFromFront(0.75, 0.5)).toBe(-1);
  });

  it('distância de entrada é a face da frente da caixa', () => {
    const t = rayVsBobo(0, 0, 0, 0, false, 0, 1.25, 10, 0, 0, -1, 100, out);
    expect(t).toBeCloseTo(10 - HITBOXES.head[2] / 2);
  });

  it('o yaw gira as caixas: de lado, o braço tapa o tronco', () => {
    // Virado 90° (olhando para -X), um tiro vindo de +Z pega o braço direito antes do tronco.
    const t = rayVsBobo(0, 0, 0, Math.PI / 2, false, 0, 0.75, 10, 0, 0, -1, 100, out);
    expect(out.part).toBe(2);
    expect(t).toBeCloseTo(10 - (HITBOXES.torso[0] / 2 + HITBOXES.arm[0]));
  });

  it('agachado: cabeça desce e mantém 0,5 m; acima de 0,95 m não pega nada', () => {
    expect(shootFromFront(0.7, 0, 0, true)).toBe(0);
    expect(shootFromFront(1.0, 0, 0, true)).toBe(-1);
    expect(shootFromFront(0.3, 0, 0, true)).toBe(1);
    expect(aimPointHeight(ENTITY_FLAG.crouching, true)).toBeCloseTo(METRICS.crouchHeight - 0.25);
    expect(aimPointHeight(0, true)).toBeCloseTo(1.25);
    expect(aimPointHeight(0, false)).toBeCloseTo(0.75);
    expect(eyeHeightFor(ENTITY_FLAG.crouching)).toBe(METRICS.crouchEyeHeight);
  });

  it('queda de dano do fuzil: 28 até 35 m, 20 a partir de 60 m', () => {
    expect(weaponDamageAt(WEAPON_RIFLE, 10)).toBe(28);
    expect(weaponDamageAt(WEAPON_RIFLE, 47.5)).toBeCloseTo(24);
    expect(weaponDamageAt(WEAPON_RIFLE, 100)).toBe(20);
  });
});
