import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createMixer, GAME_SYNTH_SOUNDS } from '@boboforces/audio';
import { createFakeAudioContext } from '@boboforces/audio/testing';
import { describe, expect, it } from 'vitest';
import { loadSoundFiles, SOUND_IDS, SOUND_RANK, soundPath, SOUNDS, type SoundId } from './sound-bank.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const runtime = JSON.parse(readFileSync(join(ROOT, 'assets-src/runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const table = JSON.parse(readFileSync(join(ROOT, 'assets-src/audio/sounds.json'), 'utf8')) as {
  sounds: { out: string }[];
};
const fileIds = SOUND_IDS.filter((id) => SOUNDS[id].src === 'file');
const synthIds = SOUND_IDS.filter((id) => SOUNDS[id].src === 'synth');

describe('banco de sons (fase 7a)', () => {
  it('cerca de 40 sons, como pede o arte-ux §10.5', () => {
    expect(SOUND_IDS.length).toBeGreaterThanOrEqual(40);
    expect(SOUND_IDS.length).toBeLessThanOrEqual(60);
  });

  it('todo MP3 está no runtime-assets.json e na tabela do audioconv', () => {
    const outs = new Set(table.sounds.map((s) => s.out));
    for (const id of fileIds) {
      expect(runtime.files[soundPath(id)], id).toBe(`audio/generated/${id}.mp3`);
      expect(outs.has(id), id).toBe(true);
    }
  });

  it('todo som sintetizado tem receita, e toda receita está no banco', () => {
    for (const id of synthIds) expect(GAME_SYNTH_SOUNDS[id], id).toBeTypeOf('function');
    for (const name of Object.keys(GAME_SYNTH_SOUNDS)) expect(SOUND_IDS, name).toContain(name);
  });

  it('volume, prioridade e cooldown dentro dos limites', () => {
    const ranks = new Set<number>(Object.values(SOUND_RANK));
    for (const id of SOUND_IDS) {
      const s = SOUNDS[id];
      expect(s.volume).toBeGreaterThan(0);
      expect(s.volume).toBeLessThanOrEqual(1);
      expect(ranks.has(s.priority), id).toBe(true);
      expect(s.cooldownS).toBeGreaterThanOrEqual(0);
      expect(s.cooldownS).toBeLessThanOrEqual(1);
    }
  });

  it('os MP3 do jogo cabem com folga nos sons essenciais da primeira partida (≤ 150 KB)', () => {
    let bytes = 0;
    for (const id of fileIds) bytes += statSync(join(ROOT, 'assets-src', runtime.files[soundPath(id)]!)).size;
    expect(bytes).toBeLessThan(120_000);
  });

  it('carrega só os MP3 que faltam, e um erro não para o resto', async () => {
    const ctx = createFakeAudioContext();
    const mixer = createMixer({ context: ctx, unlocked: true, onUnlock: () => () => {} });
    const broken: SoundId = 'ui-erro';
    const errors: SoundId[] = [];
    const asked: string[] = [];
    const assets = {
      loadBytes: (path: string) => {
        asked.push(path);
        return Promise.resolve(path === soundPath(broken) ? new Uint8Array(0) : new Uint8Array([2, 0xff, 0xfb]));
      },
      loadText: () => Promise.reject(new Error('sem texto')),
    };
    const ok = await loadSoundFiles(mixer, assets, (id) => errors.push(id));
    expect(ok).toBe(fileIds.length - 1);
    expect(errors).toEqual([broken]);
    expect(asked.length).toBe(fileIds.length);
    expect(mixer.has('hitmarker')).toBe(true);
    expect(mixer.has('tiro-fuzil')).toBe(false);
    // Segunda vez: só o que faltou.
    asked.length = 0;
    await loadSoundFiles(mixer, assets, () => {});
    expect(asked).toEqual([soundPath(broken)]);
  });

  it('sem áudio, não baixa nada', async () => {
    const mixer = createMixer(null);
    let asked = 0;
    const assets = {
      loadBytes: () => {
        asked++;
        return Promise.resolve(new Uint8Array([1]));
      },
      loadText: () => Promise.reject(new Error('sem texto')),
    };
    expect(await loadSoundFiles(mixer, assets, () => {})).toBe(0);
    expect(asked).toBe(0);
  });
});
