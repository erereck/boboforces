import type { FigureLook, MapDocument } from '@boboforces/format';
import type { MenuInput, RawInputState } from '@boboforces/input';
import { createRng } from '@boboforces/shared';
import { buildTabbed, TABBED_ROW_PREFIX, TABBED_TAB_PREFIX, type DrawList } from '@boboforces/ui';
import { BOBO_TAB_KEYS, BOBO_TABS, boboRows, boboSummary, randomBobo, stepBobo, stepPreview } from '../bobo-editor.ts';
import { createMenuController, followTab, type UiFrame } from '../menu.ts';
import type { SceneBobo, SceneSignal } from '../scene-api.ts';

/**
 * M2 (fase 6c): o Meu Bobo numa cena própria (o editor precisa do bobo em 3D, e o 3D só existe no pacote da cena).
 * O Ringue carrega (é pequeno), um manequim entra no meio do tablado e uma câmera fixa o enquadra no terço esquerdo; o
 * painel do editor fica à direita. O bobo gira devagar sozinho. Cada mudança vale na hora e vai para o `bobo@1`.
 */
export const WARDROBE = {
  mannequin: 'vestiario',
  camera: 'vestiario',
  /** Id do look do manequim (refeito a cada mudança pelo `SceneFigures.restyle`). */
  lookId: 'meu-bobo',
  /** O bobo no meio do tablado do Ringue (topo a 1,5 m), de frente para +Z (para a câmera). */
  x: 24,
  y: 1.5,
  z: 24,
  yaw: Math.PI,
  /** A câmera, 3,3 m na frente e 1,6 m à direita, olhando reto (o bobo fica à esquerda da tela, longe do painel). */
  camera3: { x: 25.6, y: 2.7, z: 27.3, lookY: 2.35, fovYDeg: 52 },
  /** Giro sozinho (graus por segundo). */
  spinDegS: 20,
} as const;

export const WARDROBE_ACTION = { back: 'back', random: 'random' } as const;

/** O mapa com o manequim e a câmera do Meu Bobo (o loading passa este documento para a cena). */
export function wardrobeMap(doc: MapDocument): MapDocument {
  const W = WARDROBE;
  const c = W.camera3;
  const dz = W.z - c.z;
  return {
    ...doc,
    markers: {
      ...doc.markers,
      mannequins: [
        ...doc.markers.mannequins,
        {
          name: W.mannequin,
          x: W.x,
          y: W.y,
          z: W.z,
          yaw: W.yaw,
          look: 'recruit',
          team: -1,
          zombie: false,
          pose: 'stand',
          weapon: 'rifle',
        },
      ],
      cameras: [
        ...doc.markers.cameras,
        {
          name: W.camera,
          x: c.x,
          y: c.y,
          z: c.z,
          // Reto para −Z (yaw 0), um pouco para baixo, até o peito do bobo.
          yaw: 0,
          pitch: Math.atan2(c.lookY - c.y, Math.abs(dz)),
          fovYDeg: c.fovYDeg,
        },
      ],
    },
  };
}

export interface WardrobeDeps {
  readonly bobo: SceneBobo;
  /** Veste o manequim com o look no time da prévia (−1 sem time). */
  apply(look: FigureLook, team: number): void;
  /** O giro do manequim, em graus. */
  turn(deg: number): void;
  readonly seed: number;
  log(line: string): void;
}

export interface Wardrobe {
  /** Um frame do editor: `quit` = Voltar. */
  frame(dt: number, input: MenuInput, raw: Readonly<RawInputState>, ui: UiFrame): SceneSignal;
  draw(list: DrawList, ui: UiFrame): void;
}

export function createWardrobe(deps: WardrobeDeps): Wardrobe {
  let doc = deps.bobo.current;
  let tab = 0;
  let preview = -1;
  let turn = 0;
  const rng = createRng(deps.seed >>> 0).fork('meu-bobo');
  const menu = createMenuController();

  function rebuild(): void {
    menu.setRoot(
      buildTabbed({
        titleKey: 'menu.bobo',
        tabs: BOBO_TABS.map((k) => BOBO_TAB_KEYS[k]),
        tab,
        rows: boboRows(BOBO_TABS[tab]!, doc, preview),
        summary: boboSummary(doc),
        note: '',
        buttons: [
          { id: WARDROBE_ACTION.back, labelKey: 'menu.back', variant: 'secondary' },
          { id: WARDROBE_ACTION.random, labelKey: 'bobo.random', variant: 'secondary' },
        ],
        panel: true,
      }),
    );
  }

  function commit(next: typeof doc): void {
    if (next === doc) return;
    doc = next;
    deps.bobo.save(doc);
    deps.apply(doc.look, preview);
  }

  deps.apply(doc.look, preview);
  rebuild();
  deps.log(`[meu bobo] abriu: ${doc.preset}`);

  return {
    frame(dt, input, raw, ui) {
      turn = (turn + WARDROBE.spinDegS * dt) % 360;
      deps.turn(turn);
      const nav = menu.update(input, raw, ui);
      const a = nav.activated;
      if (nav.tab !== 0) {
        tab = (tab + nav.tab + BOBO_TABS.length) % BOBO_TABS.length;
        followTab(menu, tab);
        rebuild();
      } else if (nav.back || a === WARDROBE_ACTION.back) {
        deps.log(`[meu bobo] saiu: ${doc.preset}`);
        return 'quit';
      } else if (a === WARDROBE_ACTION.random || a === `${TABBED_ROW_PREFIX}random`) {
        commit(randomBobo(doc, rng));
        rebuild();
      } else if (a !== null && a.startsWith(TABBED_TAB_PREFIX)) {
        tab = Number(a.slice(TABBED_TAB_PREFIX.length));
        rebuild();
      } else if (a !== null && a.startsWith(TABBED_ROW_PREFIX)) {
        const id = a.slice(TABBED_ROW_PREFIX.length);
        if (id === 'preview') {
          preview = stepPreview(preview, nav.delta);
          deps.apply(doc.look, preview);
        } else commit(stepBobo(BOBO_TABS[tab]!, doc, id, nav.delta));
        rebuild();
      }
      return 'none';
    },
    draw(list, ui) {
      menu.draw(list, ui);
    },
  };
}
