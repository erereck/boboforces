// audioconv: OGG (CC0 da Kenney) → MP3 mono. Frente "switch-audio" (decisão #47, regra 23).
//
//   npm run audioconv            converte o que `assets-src/audio/sounds.json` lista
//   npm run audioconv -- --check só confere a tabela e as licenças (sem Edge)
//
// Etapas: (1) decodificar o OGG no Edge instalado (playwright-core, `OfflineAudioContext`), já reamostrado para
// 44,1 kHz e somado em mono; (2) cortar silêncio inicial, limitar a duração com fade e normalizar o pico
// (`processPcm`); (3) `encodeMp3` (lamejs, 96 kbps). Grava `assets-src/audio/generated/<out>.mp3`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createDecoder } from './decode.ts';
import { encodeMp3, MP3_DEFAULTS } from './mp3.ts';
import { AUDIO_OUT_DIR, AUDIO_SOURCE_DIR, ROOT, SOUND_TABLE } from './paths.ts';
import { processPcm } from './process.ts';
import { readSoundTable } from './sounds.ts';

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
