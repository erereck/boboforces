import { DEFAULT_BOBO, FIGURE_PRESETS, normalizeBoboLook, validateBobo } from '@boboforces/format';
import { createRng } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import {
  BOBO_TABS,
  boboRows,
  boboSummary,
  CLOTH_COLORS,
  isPristine,
  randomBobo,
  READY_LOOKS,
  SKIN_TONES,
  stepBobo,
  stepPreview,
} from './bobo-editor.ts';

/** M2, fase 6c: o editor do Meu Bobo (linhas, passos, prévia e o sorteio). */

const value = (tab: (typeof BOBO_TABS)[number], doc = DEFAULT_BOBO, id: string): string => {
  const row = boboRows(tab, doc, -1).find((r) => r.id === id)!;
  return row.kind === 'option' ? row.value : '';
};

describe('Meu Bobo: o editor', () => {
  it('toda aba tem linhas; o padrão é o Recruta, sem mudança', () => {
    for (const tab of BOBO_TABS) expect(boboRows(tab, DEFAULT_BOBO, -1).length, tab).toBeGreaterThan(0);
    expect(boboSummary(DEFAULT_BOBO)).toBe('Recruta');
    expect(isPristine(DEFAULT_BOBO)).toBe(true);
    expect(value('hair', DEFAULT_BOBO, 'hairStyle')).toBe('Raspado');
    expect(value('outfit', DEFAULT_BOBO, 'fabric')).toBe('Camuflado mata');
  });

  it('o visual pronto troca o look inteiro e dá a volta; mexer numa peça vira "editado"', () => {
    let doc = stepBobo('ready', DEFAULT_BOBO, 'preset', 1);
    expect([doc.preset, doc.look]).toEqual(['mechanic', FIGURE_PRESETS.mechanic]);
    doc = stepBobo('ready', DEFAULT_BOBO, 'preset', -1);
    expect(doc.preset).toBe(READY_LOOKS.at(-1));
    const edited = stepBobo('face', DEFAULT_BOBO, 'beard', 1);
    expect(edited.look.beard).toBe(1);
    expect(edited.preset).toBe('recruit');
    expect(boboSummary(edited)).toBe('Recruta, editado');
    // O documento editado passa no validador sem aviso.
    const r = validateBobo(JSON.parse(JSON.stringify(edited)));
    expect(r.ok && r.warnings).toEqual([]);
  });

  it('cores andam pela paleta (a cor fora dela parte da mais parecida); colete e luvas têm "nenhum"', () => {
    const skin = stepBobo('face', DEFAULT_BOBO, 'skin', 1);
    expect(SKIN_TONES).toContain(skin.look.skinTone);
    expect(skin.look.skinTone).not.toBe(DEFAULT_BOBO.look.skinTone);
    // Do último tom fantasia volta ao primeiro.
    let doc = { ...DEFAULT_BOBO, look: { ...DEFAULT_BOBO.look, skinTone: SKIN_TONES.at(-1)! } };
    doc = stepBobo('face', doc, 'skin', 1);
    expect(doc.look.skinTone).toBe(SKIN_TONES[0]);
    // Colete: … → último → sem colete → primeiro.
    let v = {
      ...DEFAULT_BOBO,
      look: { ...DEFAULT_BOBO.look, outfit: { ...DEFAULT_BOBO.look.outfit, vest: CLOTH_COLORS.at(-1)! } },
    };
    v = stepBobo('outfit', v, 'vest', 1);
    expect(v.look.outfit.vest).toBe(-1);
    expect(boboRows('outfit', v, -1).find((r) => r.id === 'vest')).toMatchObject({ value: 'Sem colete' });
    v = stepBobo('outfit', v, 'vest', 1);
    expect(v.look.outfit.vest).toBe(CLOTH_COLORS[0]);
  });

  it('o corte "Descolorido" pinta o topo claro; trocar de corte volta ao topo da cor do cabelo', () => {
    let doc = { ...DEFAULT_BOBO, look: normalizeBoboLook({ ...DEFAULT_BOBO.look, hairStyle: 10, hairTop: undefined }) };
    doc = stepBobo('hair', doc, 'hairStyle', 1);
    expect(doc.look.hairStyle).toBe(11);
    expect(doc.look.hairTop).toBe(0xeee5c9);
    doc = stepBobo('hair', doc, 'hairStyle', 1);
    expect(doc.look.hairTop).toBe(doc.look.hair);
  });

  it('a prévia passa sem time → time 1 → time 2; o sorteio dá um bobo válido e nunca zumbi', () => {
    expect([stepPreview(-1, 1), stepPreview(0, 1), stepPreview(1, 1), stepPreview(-1, -1)]).toEqual([0, 1, -1, 1]);
    const rng = createRng(7);
    for (let i = 0; i < 20; i++) {
      const doc = randomBobo(DEFAULT_BOBO, rng);
      expect(doc.look.zombie).toBeNull();
      expect(normalizeBoboLook(doc.look)).toEqual(doc.look);
      expect(doc.preset).toBe('recruit');
    }
  });
});
