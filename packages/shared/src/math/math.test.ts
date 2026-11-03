import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  HALF_PI,
  i16ToPitch,
  lerpAngle,
  PI,
  pitchToI16,
  TAU,
  u16ToYaw,
  wrapAngle,
  yawToU16,
} from './angle.ts';
import { clamp, floorDiv, inverseLerp, lerp, mod, moveTowards, smoothstep } from './scalar.ts';
import {
  add3,
  cross3,
  dot3,
  flatForwardFromYaw,
  flatRightFromYaw,
  forwardFromYawPitch,
  length3,
  load3,
  normalize3,
  store3,
  vec3,
} from './vec3.ts';

describe('escalares', () => {
  it('clamp, lerp, inverseLerp, smoothstep, moveTowards', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(lerp(2, 4, 0.5)).toBe(3);
    expect(inverseLerp(2, 4, 3)).toBe(0.5);
    expect(inverseLerp(1, 1, 3)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(moveTowards(0, 10, 3)).toBe(3);
    expect(moveTowards(0, -1, 3)).toBe(-1);
  });

  it('mod e floorDiv tratam negativos (célula → chunk)', () => {
    expect(mod(-1, 32)).toBe(31);
    expect(floorDiv(-1, 32)).toBe(-1);
    expect(floorDiv(31, 32)).toBe(0);
  });
});

describe('ângulos', () => {
  it('wrapAngle normaliza em [-π, π)', () => {
    expect(wrapAngle(PI)).toBeCloseTo(-PI);
    expect(wrapAngle(3 * PI)).toBeCloseTo(-PI);
    expect(wrapAngle(-0.5)).toBeCloseTo(-0.5);
    expect(angleDelta(PI - 0.1, -PI + 0.1)).toBeCloseTo(0.2);
    expect(lerpAngle(PI - 0.1, -PI + 0.1, 0.5)).toBeCloseTo(-PI);
  });

  it('quantização de yaw (u16) e pitch (i16) com erro pequeno', () => {
    for (const yaw of [0, 0.1, 1, PI, TAU - 0.0001, -1]) {
      const q = yawToU16(yaw);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(0xffff);
      expect(Math.abs(angleDelta(yaw, u16ToYaw(q)))).toBeLessThan(TAU / 65536);
    }
    expect(pitchToI16(HALF_PI)).toBe(32767);
    expect(pitchToI16(-10)).toBe(-32767);
    expect(i16ToPitch(pitchToI16(0.3))).toBeCloseTo(0.3, 4);
  });
});

describe('vec3', () => {
  it('operações escrevem em out', () => {
    const a = vec3(1, 0, 0);
    const b = vec3(0, 1, 0);
    const out = vec3();
    expect(add3(out, a, b)).toBe(out);
    expect(out).toEqual([1, 1, 0]);
    expect(cross3(out, a, b)).toEqual([0, 0, 1]);
    expect(dot3(a, b)).toBe(0);
    expect(length3(normalize3(out, vec3(3, 4, 0)))).toBeCloseTo(1);
    expect(normalize3(out, vec3())).toEqual([0, 0, 0]);
  });

  it('load3/store3 com passo 3 em typed arrays', () => {
    const arr = new Float64Array(6);
    store3(arr, 1, [4, 5, 6]);
    expect(Array.from(arr)).toEqual([0, 0, 0, 4, 5, 6]);
    expect(load3(vec3(), arr, 1)).toEqual([4, 5, 6]);
  });

  it('convenção de eixos: yaw 0 olha para -Z, yaw +90° olha para -X, pitch + olha para cima', () => {
    const f = forwardFromYawPitch(vec3(), 0, 0);
    expect(f[0]).toBeCloseTo(0);
    expect(f[2]).toBeCloseTo(-1);
    const left = flatForwardFromYaw(vec3(), HALF_PI);
    expect(left[0]).toBeCloseTo(-1);
    expect(left[2]).toBeCloseTo(0);
    const right = flatRightFromYaw(vec3(), 0);
    expect(right).toEqual([1, 0, -0]);
    expect(forwardFromYawPitch(vec3(), 0, 0.5)[1]).toBeGreaterThan(0);
  });
});
