// M2 (fase 7a): o banco de sons do jogo (arte-ux.md §10.4–§10.5). Cada som diz de onde vem (MP3 convertido dos CC0
// da Kenney pelo tools/audioconv, em `audio/<id>.mp3`, ou síntese em código, `GAME_SYNTH_SOUNDS` do `audio`), o canal,
// o volume relativo (os MP3 saem todos a -1 dBFS: a mixagem mora aqui), a prioridade base e o cooldown. Fica no chunk
// do menu (a interface toca daqui); a síntese só roda na cena (`scene/sound.ts`), fora do menu.
import type { AudioBus, Mixer } from '@boboforces/audio';
import type { AudioSettings } from '@boboforces/format';
import type { Assets } from '@boboforces/platform-api';

/**
 * Prioridade para o teto de 24 vozes (arte-ux §10.4): sua arma > dano em você > inimigos perto > aliados > ambiente.
 * A interface fica acima de tudo. Os sons com dono (tiro, explosão…) trocam a base pelo parentesco na hora de tocar.
 */
export const SOUND_RANK = { world: 1, ally: 2, enemy: 3, hurt: 4, own: 5, ui: 6 } as const;

export interface SoundDef {
  /** `file` = `audio/<id>.mp3` (runtime-assets.json); `synth` = `GAME_SYNTH_SOUNDS[id]`. */
  readonly src: 'file' | 'synth';
  readonly bus: AudioBus;
  /** Volume relativo em [0, 1], antes da distância e dos canais. */
  readonly volume: number;
  readonly priority: number;
  /** Intervalo mínimo entre duas vezes do mesmo som (s): 12 bots atirando não viram 12 tiros juntos (§10.4). */
  readonly cooldownS: number;
}

const ui = (volume: number, cooldownS = 0.03): SoundDef => ({
  src: 'file',
  bus: 'ui',
  volume,
  priority: SOUND_RANK.ui,
  cooldownS,
});
const sfx = (
  src: SoundDef['src'],
  volume: number,
  priority: number = SOUND_RANK.world,
  cooldownS = 0.03,
): SoundDef => ({ src, bus: 'sfx', volume, priority, cooldownS });
const shot = (volume: number): SoundDef => sfx('synth', volume, SOUND_RANK.enemy, 0.04);

export const SOUNDS = {
  // Interface (menus, pausa, resultado).
  'ui-mover': ui(0.45),
  'ui-confirmar': ui(0.6, 0.05),
  'ui-voltar': ui(0.55, 0.05),
  'ui-trocar': ui(0.45),
  'ui-erro': ui(0.55, 0.1),
  // Retorno ao jogador: hitmarker "plic", headshot "PLOC", abate, dano, morte e vida baixa.
  hitmarker: sfx('file', 0.5, SOUND_RANK.own),
  ploc: sfx('synth', 0.75, SOUND_RANK.own, 0.05),
  abate: sfx('file', 0.65, SOUND_RANK.own, 0.05),
  dano: sfx('file', 0.7, SOUND_RANK.hurt, 0.12),
  morte: sfx('file', 0.9, SOUND_RANK.hurt, 0.5),
  coracao: sfx('synth', 0.55, SOUND_RANK.hurt, 0.6),
  // Tiros (perto e longe, que troca além de `FAR_SHOT_M`).
  'tiro-pistola': shot(0.75),
  'tiro-pistola-longe': shot(0.75),
  'tiro-smg': shot(0.65),
  'tiro-smg-longe': shot(0.65),
  'tiro-fuzil': shot(0.8),
  'tiro-fuzil-longe': shot(0.8),
  'tiro-escopeta': shot(0.9),
  'tiro-escopeta-longe': shot(0.9),
  'tiro-sniper': shot(1),
  'tiro-sniper-longe': shot(1),
  foguete: sfx('synth', 0.85, SOUND_RANK.enemy, 0.1),
  'faca-golpe': sfx('synth', 0.55, SOUND_RANK.enemy, 0.08),
  'faca-acerto': sfx('file', 0.8, SOUND_RANK.enemy, 0.08),
  // Mãos na arma.
  'recarga-tira': sfx('file', 0.45, SOUND_RANK.ally, 0.1),
  'recarga-poe': sfx('file', 0.5, SOUND_RANK.ally, 0.1),
  'sem-municao': sfx('file', 0.6, SOUND_RANK.ally, 0.12),
  'troca-arma': sfx('file', 0.4, SOUND_RANK.ally, 0.08),
  'granada-pino': sfx('file', 0.55, SOUND_RANK.enemy, 0.1),
  'granada-quica': sfx('file', 0.55, SOUND_RANK.world, 0.08),
  explosao: sfx('file', 1, SOUND_RANK.enemy, 0.05),
  'explosao-longe': sfx('file', 1, SOUND_RANK.enemy, 0.05),
  // Impactos por família de material (o `stepSound` dos blocos) e no bobo.
  'impacto-concreto': sfx('file', 0.32),
  'impacto-metal': sfx('file', 0.32),
  'impacto-madeira': sfx('file', 0.35),
  'impacto-vidro': sfx('file', 0.32),
  'impacto-macio': sfx('file', 0.35),
  'impacto-bobo': sfx('file', 0.5, SOUND_RANK.ally),
  // Movimento: o compasso dos passos é por bobo, sem cooldown global.
  'passo-concreto-1': sfx('file', 0.3, SOUND_RANK.world, 0),
  'passo-concreto-2': sfx('file', 0.3, SOUND_RANK.world, 0),
  'passo-metal': sfx('file', 0.28, SOUND_RANK.world, 0),
  'passo-madeira': sfx('file', 0.32, SOUND_RANK.world, 0),
  'passo-grama': sfx('file', 0.32, SOUND_RANK.world, 0),
  'passo-tecido': sfx('file', 0.32, SOUND_RANK.world, 0),
  pulo: sfx('file', 0.3, SOUND_RANK.world, 0.1),
  pouso: sfx('file', 0.5, SOUND_RANK.world, 0.1),
  deslize: sfx('synth', 0.4, SOUND_RANK.world, 0.2),
  // Mundo e partida.
  municao: sfx('file', 0.6, SOUND_RANK.own, 0.1),
  'contagem-bipe': sfx('synth', 0.55, SOUND_RANK.ui, 0.3),
  'contagem-vai': sfx('synth', 0.6, SOUND_RANK.ui, 0.3),
  // Vinhetas de fim: no canal da música (GDD §5.10).
  vitoria: { src: 'synth', bus: 'music', volume: 0.7, priority: SOUND_RANK.ui, cooldownS: 1 },
  derrota: { src: 'synth', bus: 'music', volume: 0.7, priority: SOUND_RANK.ui, cooldownS: 1 },
} as const satisfies Readonly<Record<string, SoundDef>>;

export type SoundId = keyof typeof SOUNDS;

/** Os ids em ordem estável (índice = posição no cooldown por som). */
export const SOUND_IDS = Object.keys(SOUNDS) as readonly SoundId[];

/** Caminho lógico do MP3 de um som `file`. */
export const soundPath = (id: SoundId): string => `audio/${id}.mp3`;

/** Quantos MP3 decodificar ao mesmo tempo (o loading não trava o frame do menu). */
const DECODE_CONCURRENCY = 4;

/**
 * Baixa e decodifica os MP3 do banco que o mixer ainda não tem (segundo plano, depois do menu). Erro num som vira
 * `onError` e o resto segue: jogo sem um som ainda é jogo. Devolve quantos ficaram prontos. Sem áudio, não baixa nada.
 */
export async function loadSoundFiles(
  mixer: Mixer,
  assets: Assets,
  onError: (id: SoundId, error: unknown) => void,
): Promise<number> {
  if (!mixer.available) return 0;
  const queue = SOUND_IDS.filter((id) => SOUNDS[id].src === 'file' && !mixer.has(id));
  let ok = 0;
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        await mixer.decode(id, await assets.loadBytes(soundPath(id)));
        ok++;
      } catch (error) {
        onError(id, error);
      }
    }
  };
  await Promise.all(Array.from({ length: DECODE_CONCURRENCY }, worker));
  return ok;
}

/** Volume do Ajuste (0..10) → ganho do canal. O quadrado soa mais por igual que a reta (o ouvido é logarítmico). */
export const volumeGain = (steps: number): number => (Math.max(0, Math.min(10, steps)) / 10) ** 2;

/** M2 (fase 7c): aplica os volumes por canal e a saída mono dos Ajustes no mixer. */
export function applyAudioSettings(mixer: Mixer, a: AudioSettings): void {
  mixer.setBusVolume('master', volumeGain(a.master));
  mixer.setBusVolume('sfx', volumeGain(a.sfx));
  mixer.setBusVolume('music', volumeGain(a.music));
  mixer.setBusVolume('ui', volumeGain(a.ui));
  mixer.setMono(a.mono);
}

/**
 * M2 (fase 7d): a faixa do menu (#38 e #63: CC0 baixada, com crédito). `null` até o Erick aprovar o download; aí vira
 * `'music/menu.mp3'` no runtime-assets.json (sob demanda no size-check) e carrega depois dos efeitos.
 */
export const MENU_MUSIC: string | null = null;
/** Nome da faixa do menu no mixer. */
export const MENU_MUSIC_ID = 'musica-menu';

/**
 * Quando a música do menu toca (GDD §5.10): nos menus e no resultado; na partida, só com "Música na partida".
 */
export function wantsMusic(inScene: boolean, sceneWants: boolean, musicInMatch: boolean): boolean {
  return !inScene || sceneWants || musicInMatch;
}

/** O som de cada gesto de menu (`MenuSound` do `menu.ts`). */
export const MENU_SOUNDS = {
  move: 'ui-mover',
  confirm: 'ui-confirmar',
  back: 'ui-voltar',
  change: 'ui-trocar',
} as const satisfies Readonly<Record<string, SoundId>>;

const uiOptions = { bus: 'ui' as AudioBus, volume: 1, priority: SOUND_RANK.ui };

/** Toca um som de interface (2D, canal da interface). */
export function playUiSound(mixer: Mixer, id: SoundId): void {
  uiOptions.bus = SOUNDS[id].bus;
  uiOptions.volume = SOUNDS[id].volume;
  mixer.play(id, uiOptions);
}
