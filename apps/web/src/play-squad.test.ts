import { describe, expect, it } from 'vitest';
import { playLevelFromUrl, playSquadFromUrl } from './play-squad.ts';

describe('?bots=fabrica', () => {
  it('liga o esquadrão de fábrica só com a chave certa', () => {
    expect(playSquadFromUrl('?bots=fabrica')).toBe('factory');
    expect(playSquadFromUrl('bots=F%C3%A1brica')).toBe('factory');
    expect(playSquadFromUrl('?bench&bots=fabrica')).toBe('factory');
    expect(playSquadFromUrl('')).toBeNull();
    expect(playSquadFromUrl('?bots=outra')).toBeNull();
  });
});

describe('?nivel=', () => {
  it('aceita os nomes da interface e os ids; o resto é o padrão', () => {
    expect(playLevelFromUrl('?nivel=suado')).toBe('sweaty');
    expect(playLevelFromUrl('?nivel=Pela%20vibe')).toBe('vibe');
    expect(playLevelFromUrl('?nivel=de-boa&bots=fabrica')).toBe('chill');
    expect(playLevelFromUrl('?nivel=tryhard')).toBe('tryhard');
    expect(playLevelFromUrl('?nivel=impossivel')).toBeNull();
    expect(playLevelFromUrl('?nivel=constructor')).toBeNull();
    expect(playLevelFromUrl('')).toBeNull();
  });
});
