// Bits do hash de célula do GLSL (`bfHash` do glsl-common), refeitos em float32 com o gêmeo JS do `bfHashF`
// (`cellHash01`). Medições do M1: com `uint(bfHashF * 2^24)` os bits baixos eram quase sempre zero e o céu de
// Entardecer/Noite virava chiado (estrelas com `h & 1023 <= 4` em quase toda célula).
import { describe, expect, it } from 'vitest';
import { cellHash01 } from '../fx/colors.ts';
import { GLSL_COMMON_FRAGMENT } from './glsl-common.ts';

/** O `bfHash` atual do glsl-common: um byte dos bits altos de cada um de 3 `bfHashF` com sementes diferentes. */
function hashBits(x: number, y: number, z: number): number {
  const a = Math.floor(cellHash01(x, y, z) * 256);
  const b = Math.floor(cellHash01(x + 91, y + 17, z + 53) * 256);
  const d = Math.floor(cellHash01(x + 37, y + 113, z + 7) * 256);
  return a | (b << 8) | (d << 16);
}

describe('bits do hash de célula', () => {
  it('o GLSL monta os 24 bits pelos bits altos de 3 hashes (o teste abaixo segue esta conta)', () => {
    expect(GLSL_COMMON_FRAGMENT).toContain('uint(bfHashF(c + ivec3(91, 17, 53)) * 256.0)');
    expect(GLSL_COMMON_FRAGMENT).toContain('uint(bfHashF(c + ivec3(37, 113, 7)) * 256.0)');
  });

  it('os 10 bits baixos (estrelas, ruído das nuvens) saem bem distribuídos', () => {
    let stars = 0;
    let n = 0;
    const buckets = new Array<number>(8).fill(0);
    for (let x = -40; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        for (let z = 970; z < 1010; z++) {
          const low = hashBits(x, y, z) & 1023;
          if (low <= 4) stars++;
          buckets[low >> 7]!++;
          n++;
        }
      }
    }
    // Estrela = 5/1024 das células (~0,5%); o hash antigo dava dezenas de por cento.
    expect(stars / n).toBeGreaterThan(0.002);
    expect(stars / n).toBeLessThan(0.01);
    for (const count of buckets) expect(count / n).toBeGreaterThan(0.1);
  });

  it('o giro da UV (3 bits baixos) usa as 8 combinações', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) seen.add(hashBits(x + 7, 2 + 131, z + 17) & 7);
    expect(seen.size).toBe(8);
  });
});
