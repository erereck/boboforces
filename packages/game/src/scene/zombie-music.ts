// M3 (fase 6e): a música do Bobo Zombies em 2 camadas (GDD §5.10). A calma toca entre as ondas sempre (a música da
// partida é desligada por padrão, mas "toca entre ondas"); durante a onda, só com o Ajuste "Música na partida", e aí a
// horda entra por cima conforme os zumbis chegam perto dos jogadores locais (ou o chefão está vivo). Carrega sob demanda
// no começo da partida; enquanto não chega, nada toca. Fica no chunk da cena (o menu não paga por ela).
import type { Mixer } from '@boboforces/audio';
import { parseLoopManifest } from '@boboforces/format';
import type { Assets } from '@boboforces/platform-api';
import type { Disposable } from '@boboforces/shared';
import { ENTITY_FLAG, ENTITY_KIND, ZOMBIE_TYPE, type SimView } from '@boboforces/sim';

/** As 2 camadas: caminho lógico (`<base>.mp3` + `<base>.json` com o `loop@1`) e o nome no mixer. */
export const ZOMBIE_MUSIC_TRACKS = {
  calm: { base: 'music/zombies-calma', id: 'musica-zombies-calma' },
  horde: { base: 'music/zombies-horda', id: 'musica-zombies-horda' },
} as const;

/** Números da intensidade (revisáveis). */
export const ZOMBIE_MUSIC_MIX = {
  /** Zumbis a até `nearM` de um jogador local; `fullAt` deles = horda cheia. */
  nearM: 15,
  fullAt: 6,
  /** Piso da horda durante a onda (a marcha não some entre um zumbi e outro). */
  floor: 0.3,
  /** De quanto em quanto tempo a intensidade é refeita (s), o passo mínimo para mexer no ganho e a rampa. */
  everyS: 0.5,
  step: 0.08,
  fadeS: 1.5,
} as const;

export interface ZombieMusicState {
  /** Partida valendo (não acabou). */
  readonly live: boolean;
  /** O resultado está na tela (a música do menu volta). */
  readonly result: boolean;
  /** Ajuste "Música na partida". */
  readonly musicInMatch: boolean;
  /** Os jogadores locais (índices de entidade; -1 = nenhum). */
  readonly locals: readonly number[];
}

export interface ZombieMusic extends Disposable {
  /** A cena manda na música agora (o núcleo não toca a do menu por cima). */
  readonly owns: boolean;
  frame(v: SimView, dt: number, state: ZombieMusicState): void;
}

/** O que a horda deve tocar agora (0..1): zumbis perto dos locais, o piso, e cheia com o chefão vivo. */
export function hordeIntensity(v: SimView, locals: readonly number[]): number {
  const near2 = ZOMBIE_MUSIC_MIX.nearM * ZOMBIE_MUSIC_MIX.nearM;
  let near = 0;
  for (let i = 0; i < v.count; i++) {
    if (v.kind[i] !== ENTITY_KIND.zombie || v.alive[i] !== 1 || v.flags[i]! & ENTITY_FLAG.dead) continue;
    if (v.zombieType[i] === ZOMBIE_TYPE.boss) return 1;
    const o = i * 3;
    for (const h of locals) {
      if (h < 0 || h >= v.count) continue;
      const dx = v.position[o]! - v.position[h * 3]!;
      const dz = v.position[o + 2]! - v.position[h * 3 + 2]!;
      if (dx * dx + dz * dz <= near2) {
        near++;
        break;
      }
    }
  }
  return Math.max(ZOMBIE_MUSIC_MIX.floor, Math.min(1, near / ZOMBIE_MUSIC_MIX.fullAt));
}

export function createZombieMusic(mixer: Mixer, assets: Assets, log: (line: string) => void): ZombieMusic {
  const { calm, horde } = ZOMBIE_MUSIC_TRACKS;
  let ready = mixer.has(calm.id) && mixer.has(horde.id);
  let disposed = false;
  let owns = false;
  /** O que está pedido ao mixer: 0 = nada, 1 = só a calma, 2 = calma + horda. */
  let playing = 0;
  let hordeGain = -1;
  let clock = 0;

  const load = async (track: { readonly base: string; readonly id: string }): Promise<void> => {
    if (mixer.has(track.id)) return;
    const loop = parseLoopManifest(JSON.parse(await assets.loadText(`${track.base}.json`)));
    await mixer.decode(track.id, await assets.loadBytes(`${track.base}.mp3`));
    if (!mixer.crop(track.id, loop.loopStartS, loop.loopS)) throw new Error(`${track.base}: o loop não cabe no MP3`);
  };
  if (!ready && mixer.available) {
    Promise.all([load(calm), load(horde)]).then(
      () => {
        ready = true;
        log('[audio] música do Bobo Zombies pronta (2 camadas)');
      },
      (error: unknown) => log(`[audio] música do Zombies: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  return {
    get owns() {
      return owns;
    },
    frame(v, dt, state) {
      if (disposed) return;
      owns = ready && !state.result;
      if (!owns) {
        // O núcleo assume (a música do menu no resultado); a próxima vez que a cena mandar, recomeça do zero.
        playing = 0;
        hordeGain = -1;
        return;
      }
      const m = v.match;
      const resting = m.zombieRestTicks >= 0;
      const want = !state.live ? 0 : resting ? 1 : state.musicInMatch ? 2 : 0;
      if (want === 0) {
        if (playing !== 0) mixer.stopMusic();
        playing = 0;
        hordeGain = -1;
        return;
      }
      if (playing === 0 || mixer.music !== calm.id) mixer.playMusic(calm.id);
      playing = want;
      clock -= dt;
      if (want === 1) {
        if (hordeGain !== 0) mixer.setMusicLayer(horde.id, 0, ZOMBIE_MUSIC_MIX.fadeS);
        hordeGain = 0;
        return;
      }
      if (clock > 0 && hordeGain >= 0) return;
      clock = ZOMBIE_MUSIC_MIX.everyS;
      const target = hordeIntensity(v, state.locals);
      if (hordeGain < 0 || Math.abs(target - hordeGain) >= ZOMBIE_MUSIC_MIX.step) {
        mixer.setMusicLayer(horde.id, target, ZOMBIE_MUSIC_MIX.fadeS);
        hordeGain = target;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (owns && playing !== 0) mixer.stopMusic();
      owns = false;
    },
  };
}
