import type { Mixer } from '@boboforces/audio';
import { ENTITY_KIND, ZOMBIE_TYPE, type SimView } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import { createZombieMusic, hordeIntensity, ZOMBIE_MUSIC_TRACKS, type ZombieMusicState } from './zombie-music.ts';

/** M3, fase 6e: a música do Bobo Zombies em 2 camadas. */

interface Calls {
  play: string[];
  stop: number;
  layer: [string | null, number][];
}

function fakeMixer(loaded: boolean): Mixer & Calls {
  let music: string | null = null;
  const m = {
    available: true,
    play: [] as string[],
    stop: 0,
    layer: [] as [string | null, number][],
    has: () => loaded,
    get music() {
      return music;
    },
    playMusic(name: string) {
      m.play.push(name);
      music = name;
      return true;
    },
    stopMusic() {
      m.stop++;
      music = null;
    },
    setMusicLayer(name: string | null, gain = 1) {
      m.layer.push([name, gain]);
      return true;
    },
  };
  return m as unknown as Mixer & Calls;
}

const assets = { loadBytes: () => Promise.reject(new Error('x')), loadText: () => Promise.reject(new Error('x')) };

/** Vista mínima: o humano 0 em (0, 0, 0) e zumbis nas posições dadas (o tipo do último pode ser o chefão). */
function view(zombies: readonly [number, number][], restTicks: number, boss = false): SimView {
  const count = 1 + zombies.length;
  const position = new Float32Array(count * 3);
  zombies.forEach(([x, z], k) => {
    position[(k + 1) * 3] = x;
    position[(k + 1) * 3 + 2] = z;
  });
  const zombieType = new Uint8Array(count);
  if (boss && zombies.length > 0) zombieType[count - 1] = ZOMBIE_TYPE.boss;
  return {
    count,
    kind: Uint8Array.from({ length: count }, (_, i) => (i === 0 ? ENTITY_KIND.bobo : ENTITY_KIND.zombie)),
    alive: new Uint8Array(count).fill(1),
    flags: new Uint32Array(count),
    zombieType,
    position,
    match: { zombieRestTicks: restTicks },
  } as unknown as SimView;
}

const state = (s: Partial<ZombieMusicState> = {}): ZombieMusicState => ({
  live: true,
  result: false,
  musicInMatch: true,
  locals: [0],
  ...s,
});

describe('música do Bobo Zombies (M3, fase 6e)', () => {
  it('a horda: zumbis perto dos locais, com piso; o chefão vivo enche', () => {
    expect(hordeIntensity(view([[40, 0]], -1), [0])).toBe(0.3);
    expect(
      hordeIntensity(
        view(
          [
            [3, 0],
            [0, 5],
            [30, 30],
          ],
          -1,
        ),
        [0],
      ),
    ).toBeCloseTo(2 / 6, 9);
    expect(
      hordeIntensity(
        view(
          Array.from({ length: 8 }, () => [1, 1] as [number, number]),
          -1,
        ),
        [0],
      ),
    ).toBe(1);
    expect(hordeIntensity(view([[50, 50]], -1, true), [0])).toBe(1);
  });

  it('sem as faixas carregadas, a cena não manda na música', () => {
    const mixer = fakeMixer(false);
    const music = createZombieMusic(mixer, assets, () => {});
    music.frame(view([], 100), 0.016, state());
    expect(music.owns).toBe(false);
    expect(mixer.play).toEqual([]);
  });

  it('intervalo: a calma; onda com o Ajuste: calma + horda; sem o Ajuste: para; resultado: devolve ao núcleo', () => {
    const mixer = fakeMixer(true);
    const music = createZombieMusic(mixer, assets, () => {});
    const { calm, horde } = ZOMBIE_MUSIC_TRACKS;
    music.frame(view([], 100), 0.016, state());
    expect(music.owns).toBe(true);
    expect(mixer.play).toEqual([calm.id]);
    expect(mixer.layer).toEqual([[horde.id, 0]]);
    // A onda abriu, com 3 zumbis perto: a horda entra pela metade.
    music.frame(
      view(
        [
          [2, 0],
          [0, 2],
          [3, 3],
        ],
        -1,
      ),
      0.016,
      state(),
    );
    expect(mixer.layer.at(-1)).toEqual([horde.id, 0.5]);
    // Mesmo quadro de novo: nada muda no mixer (refeito a cada 0,5 s e só com passo de 8%).
    music.frame(
      view(
        [
          [2, 0],
          [0, 2],
          [3, 3],
        ],
        -1,
      ),
      0.016,
      state(),
    );
    expect(mixer.layer).toHaveLength(2);
    // Sem o Ajuste "Música na partida", a música para durante a onda.
    music.frame(view([[2, 0]], -1), 0.016, state({ musicInMatch: false }));
    expect(mixer.stop).toBe(1);
    // Fim da onda: a calma volta.
    music.frame(view([], 200), 0.016, state({ musicInMatch: false }));
    expect(mixer.play.at(-1)).toBe(calm.id);
    // Resultado: a cena larga a música (o núcleo põe a do menu).
    music.frame(view([], 200), 0.016, state({ result: true }));
    expect(music.owns).toBe(false);
    music.dispose();
  });
});
