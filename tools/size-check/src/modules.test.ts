import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BUDGETS, KB, MENU_FORBIDDEN_MODULES, RETIRED_ASSETS } from './budgets.ts';
import { checkBudgets, formatReport, measureDist } from './measure.ts';
import { checkMenuModules, formatModuleCheck, sourcesOf } from './modules.ts';

// Porte do boneco do FutBobo (decisão #56; PLANO do porte §B19 e risco 16): motor, pintor e tabela fora do menu, as
// skins do bobo A fora do orçamento de texturas e a meta de 300 KB do menu. Dist sintético (sem build).

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeDist(files: Record<string, string>): string {
  const dist = mkdtempSync(join(tmpdir(), 'bf-size-check-modulos-'));
  dirs.push(dist);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), content);
  }
  return dist;
}

const map = (sources: string[], sourceRoot?: string): string =>
  JSON.stringify({ version: 3, sources, ...(sourceRoot !== undefined ? { sourceRoot } : {}), mappings: '' });

const HTML =
  '<!doctype html><script type="module" src="./assets/index-a.js"></script>' +
  '<link rel="modulepreload" href="./assets/types-t.js">';

describe('módulos do boneco fora do chunk do menu (#56)', () => {
  it('lê as fontes do sourcemap com sourceRoot e barras do Windows', () => {
    expect(sourcesOf(map(['../../src/main.ts', '..\\..\\..\\..\\packages\\x.ts']))).toEqual([
      '../../src/main.ts',
      '../../../../packages/x.ts',
    ]);
    expect(sourcesOf(map(['a.ts'], 'webpack:///'))).toEqual(['webpack:///a.ts']);
    expect(sourcesOf(map(['a.ts'], 'src'))).toEqual(['src/a.ts']);
    expect(sourcesOf('{ quebrado')).toEqual([]);
  });

  it('os três grupos casam com os caminhos reais (e não com vizinhos)', () => {
    const groupOf = (path: string): string[] =>
      MENU_FORBIDDEN_MODULES.filter((g) => g.test.test(path)).map((g) => g.label.split(' (')[0]!);
    expect(groupOf('../../../../packages/render/src/actors/anim/engine.ts')).toEqual(['motor de animação dos bonecos']);
    expect(groupOf('../../../../packages/format/src/model/figure-paint.ts')).toEqual(['pintor da skin do boneco']);
    expect(groupOf('../../../../packages/format/src/model/figure-paint-head.ts')).toEqual(['pintor da skin do boneco']);
    expect(groupOf('../../../../packages/format/src/model/figure-table.ts')).toEqual(['tabela de jogo do boneco']);
    for (const ok of [
      'packages/format/src/model/figure.ts',
      'packages/format/src/model/figure-look.ts',
      'packages/format/src/model/figure-template.ts',
      'packages/render/src/actors/figure-row4.ts',
      'packages/render/src/actors/animals.ts',
    ]) {
      expect(groupOf(ok), ok).toEqual([]);
    }
  });

  it('reprova módulo proibido no menu, diz onde caiu cada grupo e aceita grupo fora do build', () => {
    const dist = makeDist({
      'index.html': HTML,
      'assets/index-a.js': 'import"./types-t.js";const s=()=>import("./scene-s.js");',
      'assets/index-a.js.map': map(['../../src/main.ts', '../../../../packages/format/src/model/figure-table.ts']),
      'assets/types-t.js': 'export const t=1;',
      'assets/types-t.js.map': map(['../../../../packages/render/src/types.ts']),
      'assets/scene-s.js': 'export const s=1;',
      'assets/scene-s.js.map': map([
        '../../../../packages/render/src/actors/anim/index.ts',
        '../../../../packages/format/src/model/figure-table.ts',
      ]),
    });
    const check = checkMenuModules(dist, measureDist(dist));
    expect(check.ok).toBe(false);
    expect(check.unmapped).toEqual([]);
    expect([...check.mapped].sort()).toEqual(['assets/index-a.js', 'assets/scene-s.js', 'assets/types-t.js']);
    const [anim, paint, table] = check.placements;
    expect(anim).toMatchObject({ chunks: ['assets/scene-s.js'], initialChunks: [] });
    expect(paint).toMatchObject({ chunks: [], initialChunks: [] });
    expect(table?.initialChunks).toEqual(['assets/index-a.js']);
    expect(table?.initialModules).toEqual(['../../../../packages/format/src/model/figure-table.ts']);
    const text = formatModuleCheck(check);
    expect(text).toContain('NO MENU');
    expect(text).toContain('fora do build');
    expect(text).toContain('em assets/scene-s.js');
  });

  it('passa com tudo na cena; JS do menu sem mapa invalida a checagem', () => {
    const files = {
      'index.html': HTML,
      'assets/index-a.js': 'import"./types-t.js";',
      'assets/index-a.js.map': map(['../../src/main.ts']),
      'assets/types-t.js': 'export const t=1;',
      'assets/scene-s.js': 'export const s=1;',
      'assets/scene-s.js.map': map(['../../../../packages/format/src/model/figure-paint.ts']),
    };
    const unmapped = makeDist(files);
    const check = checkMenuModules(unmapped, measureDist(unmapped));
    expect(check.unmapped).toEqual(['assets/types-t.js']);
    expect(check.ok).toBe(false);
    expect(formatModuleCheck(check)).toContain('SEM MAPA');
    const full = makeDist({ ...files, 'assets/types-t.js.map': map(['../../../../packages/render/src/types.ts']) });
    const good = checkMenuModules(full, measureDist(full));
    expect(good.ok).toBe(true);
    expect(good.placements[1]?.chunks).toEqual(['assets/scene-s.js']);
    // O sourcemap não conta no tamanho (o jogador não baixa).
    expect(measureDist(full).files.some((f) => f.path.endsWith('.map'))).toBe(false);
  });
});

describe('orçamento do porte (#56)', () => {
  it('menu: teto 350 KB e meta 300 KB (acima da meta só avisa)', () => {
    const initial = BUDGETS.find((b) => b.id === 'initial');
    expect(initial).toMatchObject({ limit: 350 * KB, goal: 300 * KB });
    const dist = makeDist({ 'index.html': '<!doctype html>' });
    const report = { ...measureDist(dist), initialTotal: 320 * KB };
    const result = checkBudgets(report).find((r) => r.budget.id === 'initial');
    expect(result).toMatchObject({ ok: true, overGoal: true });
    const text = formatReport(report, checkBudgets(report), false);
    expect(text).toContain('meta!');
    expect(text).toContain('acima da meta de 300,0 KB');
    const over = checkBudgets({ ...report, initialTotal: 351 * KB }).find((r) => r.budget.id === 'initial');
    expect(over).toMatchObject({ ok: false, overGoal: false });
    expect(checkBudgets({ ...report, initialTotal: 290 * KB }).find((r) => r.budget.id === 'initial')?.overGoal).toBe(
      false,
    );
  });

  it('partes64 e a tira dos rostos saem das texturas, contam na partida e o relatório avisa; sem eles, nada muda', () => {
    // O `RETIRED_ASSETS_FAIL` (reprovar, ligado no passo 5) é do `index.ts`; aqui só a medida e o aviso.
    for (const p of [
      'assets/skins/partes64.png',
      'assets/skins/partes64.json',
      'assets/skins/modelos64-rostos.png',
      'assets/skins/modelos64-rostos.mips.png',
      'assets/skins/modelos64-rostos.json',
    ]) {
      expect(
        RETIRED_ASSETS.some((re) => re.test(p)),
        p,
      ).toBe(true);
    }
    const base = {
      'index.html': '<!doctype html>',
      'assets/textures/blocos16.png': 'x'.repeat(300),
      'assets/models/modelos64-modelos.png': 'y'.repeat(200),
    };
    const withOld = makeDist({
      ...base,
      'assets/skins/partes64.png': 'p'.repeat(100),
      'assets/skins/modelos64-rostos.png': 'r'.repeat(50),
    });
    const old = measureDist(withOld);
    expect(old.groups.textures.total).toBe(500);
    expect(old.retired.total).toBe(150);
    expect(old.firstMatchTotal).toBe(old.initialTotal + 650);
    expect(formatReport(old, checkBudgets(old), false)).toContain('aposentados pelo porte do boneco');
    const clean = measureDist(makeDist(base));
    expect(clean.retired.files).toEqual([]);
    expect(clean.groups.textures.total).toBe(500);
    expect(formatReport(clean, checkBudgets(clean), false)).not.toContain('aposentados');
  });
});
