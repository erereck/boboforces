import { describe, expect, it } from 'vitest';
import {
  createFeelFrameSample,
  createFeelOutput,
  createFeelTickSample,
  createViewFeel,
  easeOutBack,
  feelFrame,
  feelHurt,
  feelShot,
  feelTick,
  feelTrauma,
  HURT_PUSH,
  impulsePeak,
  landCurve,
  shoulderSideStep,
  springStep,
  stepJump,
  valueNoise,
  VIEW_FEEL,
  VIEW_KICK,
  wallForcesFirst,
  type FeelFrameSample,
  type FeelOutput,
  type Spring,
  type ViewFeel,
} from './view-feel.ts';

/** M12 (fase 1): a câmera e a arma na mão (`view-feel.ts`): as molas e as curvas não dependem do FPS. */

const HZ = 60;
const TICK = 1 / HZ;
const RATES = [30, 60, 144] as const;

/** Uma trilha de ticks: a posição de cada tick (pés) e se está no chão. */
interface Track {
  y(tick: number): number;
  x(tick: number): number;
  grounded(tick: number): boolean;
  vy(tick: number): number;
}

interface Sample {
  t: number;
  camY: number;
  out: FeelOutput;
}

/**
 * Roda a câmera sobre uma trilha a `rate` frames por segundo, com a sim a 60 Hz (o `alpha` do passo fixo), e devolve a
 * altura da câmera (posição interpolada + degrau + câmera da 1ª pessoa) em cada frame.
 */
function run(
  track: Track,
  rate: number,
  seconds: number,
  frame?: (s: FeelFrameSample, t: number) => void,
  f: ViewFeel = createViewFeel(),
): Sample[] {
  const tick = createFeelTickSample();
  const s = createFeelFrameSample();
  const out: Sample[] = [];
  const frames = Math.round(seconds * rate);
  for (let k = 1; k <= frames; k++) {
    const t = k / rate;
    const simTick = Math.floor(t * HZ + 1e-9);
    const alpha = t * HZ - simTick;
    tick.tick = simTick;
    tick.entity = 7;
    tick.prevX = track.x(simTick - 1);
    tick.prevY = track.y(simTick - 1);
    tick.prevZ = 0;
    tick.x = track.x(simTick);
    tick.y = track.y(simTick);
    tick.z = 0;
    tick.vx = (track.x(simTick) - track.x(simTick - 1)) * HZ;
    tick.vy = track.vy(simTick);
    tick.vz = 0;
    tick.grounded = track.grounded(simTick);
    tick.tickDt = TICK;
    if (simTick !== f.tick) feelTick(f, tick);
    s.dt = 1 / rate;
    s.alpha = alpha;
    s.grounded = track.grounded(simTick);
    s.speed = Math.abs(tick.vx);
    s.yaw = 0;
    s.pitch = 0;
    frame?.(s, t);
    const o = createFeelOutput();
    feelFrame(f, s, 0, o);
    const base = track.y(simTick - 1) + (track.y(simTick) - track.y(simTick - 1)) * alpha;
    out.push({ t, camY: base + o.stepY + o.camY, out: o });
  }
  return out;
}

/** O valor da amostra mais perto de `t`. */
function at(samples: readonly Sample[], t: number): Sample {
  let best = samples[0]!;
  for (const s of samples) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
  return best;
}

function maxJump(samples: readonly Sample[]): number {
  let m = 0;
  for (let k = 1; k < samples.length; k++) m = Math.max(m, Math.abs(samples[k]!.camY - samples[k - 1]!.camY));
  return m;
}

const flat: Track = {
  y: () => 0,
  x: () => 0,
  grounded: () => true,
  vy: () => 0,
};

describe('molas e curvas (M12, fase 1)', () => {
  it('a mola de solução exata dá o mesmo resultado em qualquer passo', () => {
    const ends: number[] = [];
    for (const rate of RATES) {
      const sp: Spring = { x: 0, v: 40 };
      for (let k = 0; k < rate; k++) springStep(sp, 0.2, VIEW_FEEL.kickOmega, VIEW_FEEL.kickZeta, 1 / rate);
      ends.push(sp.x);
      const crit: Spring = { x: 1, v: 0 };
      for (let k = 0; k < rate / 2; k++) springStep(crit, 0, 14, 1, 1 / rate);
      ends.push(crit.x * 1e3);
    }
    expect(ends[2]).toBeCloseTo(ends[0]!, 9);
    expect(ends[4]).toBeCloseTo(ends[0]!, 9);
    expect(ends[3]).toBeCloseTo(ends[1]!, 9);
    expect(ends[5]).toBeCloseTo(ends[1]!, 9);
  });

  it('o coice: pico na força da arma em ~66 ms, igual a 30, 60 e 144 Hz', () => {
    expect(impulsePeak(VIEW_FEEL.kickOmega, VIEW_FEEL.kickZeta)).toBeCloseTo(0.0279, 3);
    const at100: number[] = [];
    for (const rate of RATES) {
      const f = createViewFeel();
      feelShot(f, VIEW_KICK.shotgun.force, false);
      let peak = 0;
      const s = createFeelFrameSample();
      s.dt = 1 / rate;
      const o = createFeelOutput();
      for (let k = 1; k <= rate / 2; k++) {
        feelFrame(f, s, 0, o);
        peak = Math.max(peak, f.kick.x);
        if (k * 6 === rate) at100.push(f.kick.x);
      }
      // A 30 Hz o frame mais perto do pico (66 ms) fica a ~1 ms dele.
      expect(peak).toBeGreaterThan(VIEW_KICK.shotgun.force * 0.97);
      expect(peak).toBeLessThan(VIEW_KICK.shotgun.force * 1.001);
    }
    expect(at100[1]).toBeCloseTo(at100[0]!, 9);
    expect(at100[2]).toBeCloseTo(at100[0]!, 9);
  });

  it('as curvas: o pouso, o easeOutBack e o ruído', () => {
    expect(landCurve(1 / 20, 20)).toBeCloseTo(1, 9);
    expect(landCurve(0, 20)).toBe(0);
    expect(landCurve(0.3, 20)).toBeLessThan(0.05);
    expect(easeOutBack(0)).toBeCloseTo(0, 9);
    expect(easeOutBack(1)).toBeCloseTo(1, 9);
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(easeOutBack))).toBeGreaterThan(1);
    for (let t = 0; t < 20; t += 0.37) {
      const n = valueNoise(t, 99);
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
      expect(valueNoise(t, 99)).toBe(n);
    }
    // Contínuo: dois instantes colados dão quase o mesmo valor.
    expect(Math.abs(valueNoise(3.5, 7) - valueNoise(3.501, 7))).toBeLessThan(0.01);
  });
});

describe('degrau, escalada e pouso (M12, fase 1)', () => {
  it('o degrau no chão é salto; a rampa e o teleporte não', () => {
    expect(stepJump(0.25, 0.11, true, true, 0, TICK)).toBe(0.25);
    expect(stepJump(-0.25, 0.11, true, true, 0, TICK)).toBe(-0.25);
    // Rampa de 45° correndo: a altura muda junto com o passo no plano.
    expect(stepJump(0.11, 0.113, true, true, 0, TICK)).toBe(0);
    expect(stepJump(0.02, 0, true, true, 0, TICK)).toBe(0);
    expect(stepJump(3, 0, true, true, 0, TICK)).toBe(0);
    // No ar: o balístico não conta; a escalada (sobe meio metro num tick), sim.
    expect(stepJump(-0.1, 0.1, false, false, -6, TICK)).toBe(0);
    expect(stepJump(0.5, 0.05, false, true, 0, TICK)).toBeCloseTo(0.5, 9);
    // Saindo do chão (o pulo): nada.
    expect(stepJump(0.08, 0.1, true, false, 5, TICK)).toBe(0);
  });

  it('um degrau de 0,25 m: a câmera sobe sem saltar e chega igual a 30, 60 e 144 Hz', () => {
    const stepAt = 30;
    const track: Track = { ...flat, y: (k) => (k >= stepAt ? 0.25 : 0) };
    const runs = RATES.map((rate) => run(track, rate, 1));
    // Sem suavizar, o salto inteiro (0,25) cai num frame a 30 e 60 Hz (0,1 a 144 Hz); com a mola, bem menos.
    const limits = [0.16, 0.09, 0.04];
    runs.forEach((r, k) => {
      expect(maxJump(r)).toBeLessThan(limits[k]!);
      expect(at(r, 0.95).camY).toBeCloseTo(0.25, 3);
    });
    // A mesma altura nos instantes em que os três frames caem juntos num tick (alpha 0): de 1/6 em 1/6 s.
    for (const t of [0.5 + 1 / 6, 0.5 + 2 / 6]) {
      expect(Math.abs(at(runs[2]!, t).camY - at(runs[1]!, t).camY)).toBeLessThan(0.002);
      expect(Math.abs(at(runs[0]!, t).camY - at(runs[1]!, t).camY)).toBeLessThan(0.002);
    }
  });

  it('a escada correndo (0,25 m a cada ~2 ticks): a câmera vira rampa, com o teto de 0,3 m', () => {
    // 6,8 m/s em degraus de 0,25 × 0,25: um degrau a cada 0,25/6,8 s.
    const per = 0.25 / 6.8;
    const track: Track = {
      ...flat,
      y: (k) => (k < 0 ? 0 : Math.floor((k * TICK) / per) * 0.25),
      x: (k) => k * TICK * 6.8,
    };
    // O quanto cada frame foge da rampa ideal (6,8 m/s): cru, 0,137 m a 60 Hz e ~0,25 a 30 Hz.
    const limits = [0.15, 0.06, 0.03];
    RATES.forEach((rate, k) => {
      const tail = run(track, rate, 1.5).filter((s) => s.t > 0.5);
      let dev = 0;
      for (let i = 1; i < tail.length; i++)
        dev = Math.max(dev, Math.abs(tail[i]!.camY - tail[i - 1]!.camY - 6.8 / rate));
      expect(dev).toBeLessThan(limits[k]!);
      for (const s of tail) expect(Math.abs(s.out.stepY)).toBeLessThan(VIEW_FEEL.stepCapM);
    });
  });

  it('revisão: degrau e pulo no mesmo frame de 30 Hz (2 ticks): o degrau entra, o pulo não', () => {
    const f = createViewFeel();
    const t = createFeelTickSample();
    t.entity = 7;
    t.tick = 10;
    t.grounded = true;
    feelTick(f, t);
    // Tick 11: subiu o degrau de 0,25 (no chão); tick 12: pulou (no ar, 7 m/s para cima).
    t.tick = 12;
    t.prevY = 0.25;
    t.y = 0.25 + 7 * TICK;
    t.prevX = 0.11;
    t.x = 0.22;
    t.vy = 7;
    t.grounded = false;
    feelTick(f, t);
    expect(f.step.x).toBeCloseTo(-0.25, 9);
    expect(f.stepDy).toBe(0);
    // Pulo no 1º tick do lote, parado: nada de degrau.
    const g = createViewFeel();
    t.tick = 10;
    t.prevY = 0;
    t.y = 0;
    t.prevX = 0;
    t.x = 0;
    t.vy = 0;
    t.grounded = true;
    feelTick(g, t);
    t.tick = 12;
    t.prevY = 7 * TICK;
    t.y = 7 * TICK + (7 - 20 * TICK) * TICK;
    t.vy = 7 - 2 * 20 * TICK;
    t.grounded = false;
    feelTick(g, t);
    expect(g.step.x).toBe(0);
    expect(g.stepDy).toBe(0);
  });

  it('revisão: o cliente online (o tick só anda no snapshot): os passos da predição como relógio', () => {
    // A posição anda a cada passo previsto (60 Hz) e sobe um degrau; o `SimView.tick` do cliente só muda a cada 2
    // passos (snapshot a 30 Hz). Com os passos somados como relógio (o `feelTicks` da cena), o degrau sobe liso; com o
    // tick do snapshot, a câmera subia, caía e subia de novo.
    const stepAt = 30;
    const y = (k: number): number => (k >= stepAt ? 0.25 : 0);
    const camera = (snapshotClock: boolean): number[] => {
      const f = createViewFeel();
      const t = createFeelTickSample();
      const s = createFeelFrameSample();
      const o = createFeelOutput();
      const ys: number[] = [];
      for (let k = 1; k <= 60; k++) {
        t.entity = 7;
        t.tick = snapshotClock ? k - (k % 2) : k;
        t.prevY = y(k - 1);
        t.y = y(k);
        if (t.tick !== f.tick) feelTick(f, t);
        s.dt = TICK;
        s.alpha = 0.5;
        feelFrame(f, s, 0, o);
        ys.push(y(k - 1) + (y(k) - y(k - 1)) * 0.5 + o.stepY);
      }
      return ys;
    };
    const dips = (ys: number[]): number => {
      let down = 0;
      for (let k = 1; k < ys.length; k++) down = Math.min(down, ys[k]! - ys[k - 1]!);
      return down;
    };
    expect(dips(camera(false))).toBeGreaterThan(-1e-6);
    expect(dips(camera(true))).toBeLessThan(-0.05);
  });

  it('a rampa não mexe no degrau', () => {
    const track: Track = { ...flat, y: (k) => Math.max(0, k) * 0.1, x: (k) => k * 0.113 };
    const r = run(track, 60, 1);
    for (const s of r) expect(s.out.stepY).toBe(0);
  });

  it('o pouso pelo estado: desce até 12 cm na queda forte, nada abaixo de 3 m/s', () => {
    const landAt = 40;
    const fall = (speed: number): Track => ({
      ...flat,
      y: (k) => (k >= landAt ? 0 : (landAt - k) * speed * TICK),
      grounded: (k) => k >= landAt,
      vy: (k) => (k >= landAt ? 0 : -speed),
    });
    const hard = createViewFeel();
    run(fall(10), 60, landAt / HZ + 0.06, undefined, hard);
    expect(hard.landAmp).toBeCloseTo((10 - 3) * 0.015, 6);
    for (const rate of RATES) {
      const r = run(fall(20), rate, 1.2);
      // O fundo (12 cm) 50 ms depois do toque; a 30 Hz o frame mais perto fica a até 17 ms dele.
      const deepest = Math.min(...r.map((s) => s.out.camY));
      expect(deepest).toBeGreaterThanOrEqual(-VIEW_FEEL.landMaxM - 1e-9);
      expect(deepest).toBeLessThan(-VIEW_FEEL.landMaxM * (rate === 30 ? 0.85 : 0.97));
      // De volta em ~0,25 s.
      expect(at(r, landAt / HZ + 0.35).out.camY).toBeGreaterThan(-0.01);
    }
    const soft = createViewFeel();
    run(fall(2.5), 60, 1, undefined, soft);
    expect(soft.landT).toBeGreaterThan(10);
  });
});

describe('balanço, FOV e ADS (M12, fase 1)', () => {
  it('uma descida da câmera por passo do som, andando a 4,8 m/s', () => {
    const walk: Track = { ...flat, x: (k) => k * TICK * 4.8 };
    const f = createViewFeel();
    let last = f.soundStep;
    const atSteps: number[] = [];
    const r = run(walk, 60, 4, undefined, f);
    // Reconta: a cada troca de passo do acumulador (o mesmo do som), a câmera está perto do fundo.
    const f2 = createViewFeel();
    run(
      walk,
      60,
      4,
      (_s, t) => {
        if (f2.soundStep !== last && t > 2) atSteps.push(t);
        last = f2.soundStep;
      },
      f2,
    );
    expect(atSteps.length).toBeGreaterThan(3);
    for (const t of atSteps) {
      const s = at(r, t);
      expect(s.out.camY).toBeLessThan(-VIEW_FEEL.bobWalkM * 0.8);
    }
    // Passada de 1,7 m a 4,8 m/s: ~2,8 passos por segundo.
    expect(atSteps.length).toBeGreaterThanOrEqual(4);
  });

  it('o FOV de velocidade entra em ~0,15 s e sai em ~0,25 s; zero com Reduzir efeitos', () => {
    for (const rate of RATES) {
      const f = createViewFeel();
      const s = createFeelFrameSample();
      const o = createFeelOutput();
      s.dt = 1 / rate;
      s.sprinting = true;
      for (let k = 0; k < Math.round(0.15 * rate); k++) feelFrame(f, s, 0, o);
      expect(o.fovAddDeg).toBeGreaterThan(VIEW_FEEL.sprintFovDeg * 0.94);
      s.sprinting = false;
      s.sliding = true;
      for (let k = 0; k < Math.round(0.15 * rate); k++) feelFrame(f, s, 0, o);
      expect(o.fovAddDeg).toBeGreaterThan(VIEW_FEEL.slideFovDeg * 0.94);
      s.sliding = false;
      for (let k = 0; k < Math.round(0.25 * rate); k++) feelFrame(f, s, 0, o);
      expect(o.fovAddDeg).toBeLessThan(VIEW_FEEL.slideFovDeg * 0.06);
      s.sprinting = true;
      s.reduced = true;
      for (let k = 0; k < rate; k++) feelFrame(f, s, 0, o);
      expect(o.fovAddDeg).toBe(f.fovDeg * (1 - o.ads));
      expect(o.fovAddDeg).toBeLessThan(0.01);
    }
  });

  it('revisão: o FOV de corrida não bombeia no pulo', () => {
    const f = createViewFeel();
    const s = createFeelFrameSample();
    const o = createFeelOutput();
    s.dt = 1 / 60;
    s.sprinting = true;
    for (let k = 0; k < 30; k++) feelFrame(f, s, 0, o);
    const before = o.fovAddDeg;
    // No ar (a sim pode tirar a corrida no pulo): o FOV fica.
    s.grounded = false;
    s.sprinting = false;
    for (let k = 0; k < 30; k++) feelFrame(f, s, 0, o);
    expect(o.fovAddDeg).toBeGreaterThanOrEqual(before);
  });

  it('o ADS com smoothstep: entra no tempo da arma e sai em 0,7× ele', () => {
    const f = createViewFeel();
    const s = createFeelFrameSample();
    const o = createFeelOutput();
    s.dt = 1 / 120;
    s.adsInS = 0.3;
    s.adsTarget = 1;
    feelFrame(f, s, 0, o);
    // Começa devagar (smoothstep): 1 frame de 8 ms dá bem menos que os 2,8% lineares.
    expect(o.ads).toBeLessThan(0.01);
    for (let k = 1; k < 36; k++) feelFrame(f, s, 0, o);
    expect(o.ads).toBeCloseTo(1, 6);
    s.adsTarget = 0;
    for (let k = 0; k < 25; k++) feelFrame(f, s, 0, o);
    // 0,7 × 0,3 = 0,21 s = 25,2 frames: quase fora.
    expect(o.ads).toBeLessThan(0.01);
    expect(o.ads).toBeGreaterThan(0);
  });
});

describe('a arma na mão e o tremor (M12, fase 1)', () => {
  it('o atraso no giro: virar à esquerda leva a arma para a direita, com teto', () => {
    const f = createViewFeel();
    const s = createFeelFrameSample();
    const o = createFeelOutput();
    s.dt = 1 / 60;
    for (let k = 0; k < 20; k++) {
      s.yaw += 0.05;
      feelFrame(f, s, 0, o);
    }
    expect(o.vmX).toBeGreaterThan(0);
    expect(o.vmYaw).toBeLessThan(0);
    expect(Math.abs(o.vmYaw)).toBeLessThanOrEqual(VIEW_FEEL.swayMaxRad + 1e-9);
    // Parou de girar: volta ao centro.
    for (let k = 0; k < 60; k++) feelFrame(f, s, 0, o);
    expect(Math.abs(o.vmYaw)).toBeLessThan(1e-3);
  });

  it('a troca sobe a arma de baixo no tempo da sim; a recarga solta o pente uma vez', () => {
    const f = createViewFeel();
    const s = createFeelFrameSample();
    const o = createFeelOutput();
    s.dt = 1 / 60;
    s.weapon = 0;
    feelFrame(f, s, 0, o);
    expect(o.vmY).toBeCloseTo(0, 9);
    s.weapon = 1;
    feelFrame(f, s, 0, o);
    expect(o.vmY).toBeLessThan(-0.2);
    for (let k = 0; k < 24; k++) feelFrame(f, s, 0, o);
    expect(Math.abs(o.vmY)).toBeLessThan(0.01);
    let drops = 0;
    let deepest = 0;
    for (let k = 0; k <= 60; k++) {
      s.reload = k / 60;
      feelFrame(f, s, 0, o);
      if (o.dropMag) drops++;
      deepest = Math.min(deepest, o.vmY);
    }
    expect(drops).toBe(1);
    expect(deepest).toBeCloseTo(-VIEW_FEEL.reloadDropM, 2);
  });

  it('o tremor é trauma² e some; Reduzir efeitos zera o tremor, o balanço e o solavanco', () => {
    const f = createViewFeel();
    const s = createFeelFrameSample();
    const o = createFeelOutput();
    s.dt = 1 / 60;
    feelTrauma(f, 0.5);
    let big = 0;
    for (let k = 0; k < 10; k++) {
      feelFrame(f, s, 0, o);
      big = Math.max(big, Math.hypot(o.camX, o.camY, o.camZ));
    }
    expect(big).toBeGreaterThan(0);
    expect(big).toBeLessThan(VIEW_FEEL.shakePosM * 0.25 * 2);
    for (let k = 0; k < 60; k++) feelFrame(f, s, 0, o);
    expect(f.trauma).toBe(0);
    s.reduced = true;
    feelTrauma(f, 1);
    feelHurt(f, 40, 1, HURT_PUSH.away, true);
    s.speed = 4.8;
    s.sprinting = true;
    for (let k = 0; k < 30; k++) {
      feelFrame(f, s, 0, o);
      expect(Math.abs(o.camX)).toBe(0);
      expect(Math.abs(o.camY)).toBe(0);
      expect(Math.abs(o.camZ)).toBe(0);
      expect(Math.abs(o.shakeYaw)).toBe(0);
      expect(Math.abs(o.shakePitch)).toBe(0);
      expect(o.fovMul).toBe(1);
    }
  });

  it('o dano empurra a vista para longe do tiro, 0,5° a 1°', () => {
    const f = createViewFeel();
    const s = createFeelFrameSample();
    const o = createFeelOutput();
    s.dt = 1 / 120;
    // O tiro veio da esquerda (from = +90°): a cabeça vai para a direita (yaw negativo).
    feelHurt(f, 50, Math.PI / 2, HURT_PUSH.away, false);
    expect(f.trauma).toBeCloseTo(0.35, 6);
    let minYaw = 0;
    for (let k = 0; k < 30; k++) {
      feelFrame(f, s, 0, o);
      minYaw = Math.min(minYaw, f.hurtYaw.x);
    }
    expect(minYaw).toBeCloseTo(-VIEW_FEEL.hurtMaxRad, 4);
    expect(Math.abs(f.hurtPitch.x)).toBeLessThan(1e-3);
  });

  it('revisão: sob a SMG o solavanco fica no teto de 1°; a queda empurra para baixo; a zona, só o trauma', () => {
    const f = createViewFeel();
    const s = createFeelFrameSample();
    const o = createFeelOutput();
    s.dt = 1 / 144;
    let worst = 0;
    // 14 acertos por segundo, todos da esquerda, por 1 s.
    for (let k = 0; k < 144; k++) {
      if (k % 10 === 0) feelHurt(f, 20, Math.PI / 2, HURT_PUSH.away, false);
      feelFrame(f, s, 0, o);
      worst = Math.max(worst, Math.abs(f.hurtYaw.x));
    }
    expect(worst).toBeLessThanOrEqual(VIEW_FEEL.hurtMaxRad + 1e-12);
    const fall = createViewFeel();
    feelHurt(fall, 30, 0, HURT_PUSH.down, false);
    let low = 0;
    for (let k = 0; k < 30; k++) {
      feelFrame(fall, s, 0, o);
      low = Math.min(low, fall.hurtPitch.x);
    }
    expect(low).toBeLessThan(-VIEW_FEEL.hurtMinRad * 0.9);
    expect(Math.abs(fall.hurtYaw.x)).toBe(0);
    const zone = createViewFeel();
    feelHurt(zone, 30, 1, HURT_PUSH.none, false);
    expect(zone.trauma).toBeGreaterThan(0);
    expect(zone.hurtYaw.v).toBe(0);
    expect(zone.hurtPitch.v).toBe(0);
  });

  it('revisão: Reduzir efeitos também segura o coice; a compra na loja não anima a troca', () => {
    const s = createFeelFrameSample();
    const o = createFeelOutput();
    s.dt = 1 / 60;
    const peak = (reduced: boolean): number => {
      const f = createViewFeel();
      s.reduced = reduced;
      feelShot(f, 1, false);
      let z = 0;
      for (let k = 0; k < 10; k++) {
        feelFrame(f, s, 0, o);
        z = Math.max(z, o.vmZ);
      }
      return z;
    };
    expect(peak(true)).toBeCloseTo(peak(false) * VIEW_FEEL.reducedWeapon, 9);
    s.reduced = false;
    const f = createViewFeel();
    s.weapon = 0;
    feelFrame(f, s, 0, o);
    s.weapon = 1;
    s.quietSwitch = true;
    feelFrame(f, s, 0, o);
    expect(o.vmY).toBeCloseTo(0, 9);
  });
});

describe('a 3ª pessoa sem estalos (M12, fase 1)', () => {
  it('o ombro desliza e a parede tem histerese', () => {
    let side = 1;
    for (let k = 0; k < 9; k++) side = shoulderSideStep(side, -1, 1 / 60);
    expect(side).toBeLessThan(-0.9);
    expect(shoulderSideStep(1, -1, 1 / 60)).toBeGreaterThan(0);
    expect(wallForcesFirst(false, 1.0, 0.9, 1.2)).toBe(false);
    expect(wallForcesFirst(false, 0.85, 0.9, 1.2)).toBe(true);
    expect(wallForcesFirst(true, 1.0, 0.9, 1.2)).toBe(true);
    expect(wallForcesFirst(true, 1.25, 0.9, 1.2)).toBe(false);
  });
});
