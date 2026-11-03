import { describe, expect, it } from 'vitest';
import { getSplash } from './boot.ts';

/** Documento sintético com só o que o splash usa. */
function fakeDoc() {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  const classes = new Set<string>();
  const splash = {
    removed: false,
    get isConnected() {
      return !this.removed;
    },
    style: { setProperty: (k: string, v: string) => void props.set(k, v) },
    setAttribute: (k: string) => void attrs.set(`splash:${k}`, ''),
    addEventListener: () => {},
    classList: {
      add: (c: string) => void classes.add(c),
      remove: (c: string) => void classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    remove() {
      this.removed = true;
    },
  };
  const doc = {
    documentElement: {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    },
    body: {
      appendChild: (el: typeof splash) => {
        el.removed = false;
        return el;
      },
    },
    getElementById: (id: string) => (id === 'bf-splash' && !splash.removed ? splash : null),
    defaultView: { setTimeout: (fn: () => void) => (fn(), 0) },
  };
  return { doc: doc as unknown as Document, attrs, props, classes, splash };
}

describe('getSplash', () => {
  it('limita o progresso a [0, 1] e marca que o JS assumiu a barra', () => {
    const t = fakeDoc();
    const splash = getSplash(t.doc);
    splash.setProgress(0.5);
    expect(t.props.get('--bf-p')).toBe('0.500');
    splash.setProgress(7);
    expect(t.props.get('--bf-p')).toBe('1.000');
    splash.setProgress(Number.NaN);
    expect(t.props.get('--bf-p')).toBe('0.000');
    expect(t.attrs.has('splash:data-progress')).toBe(true);
  });

  it('troca o estado pelo atributo data-bf do <html>', () => {
    const t = fakeDoc();
    const splash = getSplash(t.doc);
    splash.show('webgl2');
    expect(t.attrs.get('data-bf')).toBe('webgl2');
    splash.show('loading');
    expect(t.attrs.has('data-bf')).toBe(false);
  });

  it('some com o splash (fade e remoção, mesmo sem transitionend)', () => {
    const t = fakeDoc();
    const splash = getSplash(t.doc);
    splash.hide();
    expect(t.classes.has('bf-out')).toBe(true);
    expect(t.splash.removed).toBe(true);
    splash.hide(); // já saiu: não quebra
    splash.setProgress(1);
  });

  it('erro depois do reveal: o splash volta para o DOM, sem o fade, com a página de erro', () => {
    const t = fakeDoc();
    const splash = getSplash(t.doc);
    splash.hide();
    expect(t.splash.removed).toBe(true);
    splash.show('error');
    expect(t.splash.removed).toBe(false);
    expect(t.classes.has('bf-out')).toBe(false);
    expect(t.attrs.get('data-bf')).toBe('error');
  });
});
