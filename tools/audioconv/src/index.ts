// audioconv: OGG (CC0 da Kenney) → MP3 mono. Frente "switch-audio" (decisão #47, regra 23).
//
//   npm run audioconv            converte o que `assets-src/audio/sounds.json` lista
//   npm run audioconv -- --check só confere a tabela e as licenças (sem Edge)
//   npm run audioconv -- --musica  converte a música (`assets-src/audio/music.json`): loop estéreo + manifesto loop@1
//
// Etapas: (1) decodificar o OGG no Edge instalado (playwright-core, `OfflineAudioContext`), já reamostrado para
// 44,1 kHz e somado em mono; (2) cortar silêncio inicial, limitar a duração com fade e normalizar o pico
// (`processPcm`); (3) `encodeMp3` (lamejs, 96 kbps). Grava `assets-src/audio/generated/<out>.mp3`.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createDecoder } from './decode.ts';
import { encodeMp3, encodeMp3Stereo, MP3_DEFAULTS } from './mp3.ts';
import { cutLoop, findOffset, LOOP_PAD_SAMPLES, loopSamples, readMusicTable, sourcePath, wrapPad } from './music.ts';
import { AUDIO_OUT_DIR, AUDIO_SOURCE_DIR, MUSIC_OUT_DIR, MUSIC_TABLE, ROOT, SOUND_TABLE } from './paths.ts';
import { processPcm } from './process.ts';
import { readSoundTable } from './sounds.ts';

if (process.argv.includes('--musica')) {
  await convertMusic();
  process.exit(0);
}

const table = readSoundTable(SOUND_TABLE);
console.log(`audioconv: ${table.sounds.length} som(ns) em ${relative(ROOT, SOUND_TABLE)}`);
if (process.argv.includes('--check')) {
  for (const s of table.sounds) console.log(`  ${s.out} ← ${s.pack}/${s.file}`);
  process.exit(0);
}

mkdirSync(AUDIO_OUT_DIR, { recursive: true });
const decoder = await createDecoder();
let total = 0;
try {
  for (const s of table.sounds) {
    const bytes = new Uint8Array(readFileSync(join(AUDIO_SOURCE_DIR, s.pack, s.file)));
    const decoded = await decoder.decode(bytes, MP3_DEFAULTS.sampleRate);
    const done = processPcm(decoded.pcm, { sampleRate: decoded.sampleRate, maxS: s.maxS, peakDb: s.peakDb });
    const mp3 = encodeMp3(done.pcm, decoded.sampleRate, MP3_DEFAULTS.kbps);
    const outPath = join(AUDIO_OUT_DIR, `${s.out}.mp3`);
    writeFileSync(outPath, mp3);
    total += mp3.length;
    console.log(
      `  ${s.out}.mp3  ${(done.pcm.length / decoded.sampleRate).toFixed(3)} s  ${(mp3.length / 1024).toFixed(1)} KB` +
        `  ← ${s.pack}/${s.file} (${decoded.sourceChannels} canal(is), ${decoded.sourceRate} Hz,` +
        ` pico ${done.sourcePeakDb.toFixed(1)} dBFS → ${s.peakDb} dBFS${done.cut ? ', cortado' : ''})`,
    );
  }
} finally {
  await decoder.close();
}
console.log(`audioconv: ${(total / 1024).toFixed(1)} KB de MP3 em ${relative(ROOT, AUDIO_OUT_DIR)}`);

/**
 * M2 (fase 7d): cada faixa vira um loop estéreo de N compassos (`cutLoop`) em MP3, mais o manifesto `loop@1` com o
 * início e a duração medidos decodificando o MP3 gerado (o atraso do codificador muda de um decodificador para outro;
 * mede-se no Edge, o mesmo motor do jogo na web).
 */
async function convertMusic(): Promise<void> {
  const tracks = readMusicTable(MUSIC_TABLE);
  mkdirSync(MUSIC_OUT_DIR, { recursive: true });
  const decoder = await createDecoder();
  try {
    for (const t of tracks) {
      const bytes = new Uint8Array(readFileSync(sourcePath(ROOT, t)));
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== t.sha256) throw new Error(`music.json: ${t.out}: SHA-256 ${sha} não bate com a tabela`);
      const src = await decoder.decodeStereo(bytes, t.sampleRate);
      const length = loopSamples(t);
      const fade = Math.round(t.crossfadeS * t.sampleRate);
      const left = cutLoop(src.left, t.startSample, length, fade);
      const right = cutLoop(src.right, t.startSample, length, fade);
      // Folga dos dois lados (o fim do loop antes, o começo depois): o MP3 borra os primeiros e os últimos ms de um
      // trecho cercado de silêncio; com a folga, as bordas do loop ficam no meio de música contínua.
      const pad = LOOP_PAD_SAMPLES;
      const mp3 = encodeMp3Stereo(wrapPad(left, pad), wrapPad(right, pad), t.sampleRate, t.kbps);
      writeFileSync(join(MUSIC_OUT_DIR, `${t.out}.mp3`), mp3);
      // Atraso do decodificador: onde o começo do loop aparece no MP3 decodificado.
      const back = await decoder.decodeStereo(mp3, t.sampleRate);
      const mid = new Float32Array(left.length);
      const backMid = new Float32Array(back.left.length);
      for (let i = 0; i < mid.length; i++) mid[i] = (left[i]! + right[i]!) / 2;
      for (let i = 0; i < backMid.length; i++) backMid[i] = (back.left[i]! + back.right[i]!) / 2;
      const { offset, correlation } = findOffset(mid, backMid, pad + 4 * 1152, Math.round(0.25 * t.sampleRate));
      if (correlation < 0.9) throw new Error(`${t.out}: atraso incerto (correlação ${correlation.toFixed(3)})`);
      if (back.left.length < offset + length) throw new Error(`${t.out}: o MP3 decodificado é curto demais`);
      const manifest = {
        format: 'boboforces/loop@1',
        loopStartS: Number((offset / t.sampleRate).toFixed(6)),
        loopS: Number((length / t.sampleRate).toFixed(6)),
      };
      writeFileSync(join(MUSIC_OUT_DIR, `${t.out}.json`), JSON.stringify(manifest, null, 2) + '\n');
      console.log(
        `  music/${t.out}.mp3  ${(length / t.sampleRate).toFixed(3)} s (${t.bars} compassos a ${t.bpm} BPM)  ` +
          `${(mp3.length / 1024).toFixed(1)} KB  atraso ${offset} amostras (correlação ${correlation.toFixed(4)})  ` +
          `← ${t.title}, ${t.author} (${src.sourceChannels} canais, ${src.sourceRate} Hz)`,
      );
    }
  } finally {
    await decoder.close();
  }
}
