import { describe, expect, it } from 'vitest';
import { NXJS_INI, NXJS_INI_NAME } from './bundle.ts';

describe('nxjs.ini do RomFS', () => {
  it('desliga o Sparkplug e mantém o JIT por modo (crash 2168-0002 no console, nx.js issue #424)', () => {
    expect(NXJS_INI_NAME).toBe('nxjs.ini');
    const lines = NXJS_INI.split('\n').filter((l) => l.trim() !== '' && !l.startsWith(';'));
    expect(lines).toEqual(['[v8]', 'jit = auto', 'flags = --no-sparkplug']);
  });

  it('só ASCII (o runtime lê o arquivo em C, antes do V8)', () => {
    expect([...NXJS_INI].every((ch) => ch.charCodeAt(0) < 0x80)).toBe(true);
  });
});
