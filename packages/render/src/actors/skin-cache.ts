// Cache de skins (tecnico.md §6.6, arte-ux.md §2.2): bobos com a MESMA aparência dividem a skin de `modelos64` (bots
// iguais = 1 skin). #56 (porte do boneco do FutBobo): cada skin ocupa `FIGURE_SKIN_LAYERS` (2) camadas seguidas,
// pintadas pelo `paintFigureSkin` do format (cabeça, expressões e paleta na 1ª; tronco e listras na 2ª); a subida
// (`writeModelLayer`, `texSubImage3D` + mips) é do renderer. Aqui só a política: chave, contagem de uso e
// reaproveitamento das skins reservadas. Sem three (vai para `@boboforces/render/data`). O pintor entra pela opção
// `paint` (o `game` passa o `paintFigureSkin`): assim ele não vem junto de quem só importa o `@boboforces/render/data`
// (o chunk do menu, PLANO §B19). A skin de 4 camadas do bobo A (`composeSkin` + `expandSkin`) saiu no passo 5.
//
// Regra do Switch: toda aparência da partida é pintada no LOADING. Pintar no meio da partida perde quadro a 30 fps; no
// M2 a reserva vem do perfil (≥ jogadores + bots) e um `acquire` fora do loading conta no relatório como os estouros.
import {
  FIGURE_SKIN_BYTES,
  FIGURE_SKIN_LAYERS,
  FIGURE_SKIN_LEVEL1_BYTES,
  figureSkinKey,
  type FigureSkinRecipe,
} from '@boboforces/format';

export interface SkinLayerCacheStats {
  /** Skins (grupos de `FIGURE_SKIN_LAYERS` camadas) ocupadas por alguma aparência. */
  readonly used: number;
  /** Composições feitas (falta no cache). */
  readonly composed: number;
  /** Pedidos atendidos sem compor (bots iguais). */
  readonly hits: number;
  /** Pedidos sem skin livre (todas em uso): caíram na skin da aparência menos recente. */
  readonly overflows: number;
}

export interface FigureSkinCacheOptions {
  /** Primeira camada reservada e quantas: cabem `floor(count / FIGURE_SKIN_LAYERS)` skins. */
  readonly firstLayer: number;
  readonly count: number;
  /** Sobe a skin a partir da sua primeira camada: `renderer.writeModelLayer(firstLayer, rgba, level1)`. */
  readonly write: (firstLayer: number, rgba: Uint8Array, level1: Uint8Array) => void;
  /**
   * Pintor: o `paintFigureSkin` do format (`out` com `FIGURE_SKIN_BYTES` e `level1` com `FIGURE_SKIN_LEVEL1_BYTES`,
   * os dois zerados antes). Os testes injetam um falso.
   */
  readonly paint: (recipe: FigureSkinRecipe, out: Uint8Array, level1: Uint8Array) => void;
  /** Chave da aparência (padrão `figureSkinKey`). */
  readonly key?: (recipe: FigureSkinRecipe) => string;
  /**
   * Chamado no `dispose()` do cache: o `game` passa o `disposeFigurePaint` do format, que solta as vistas do último
   * buffer que o pintor guarda entre chamadas (regra 21; sem isto o módulo prende os rascunhos do cache depois da
   * partida).
   */
  readonly release?: () => void;
}

/** Cache de skins do boneco do FutBobo: `ActorBuffer.skin` = 1ª das `FIGURE_SKIN_LAYERS` camadas. */
export interface FigureSkinCache {
  /** Número de skins que cabem na reserva. */
  readonly slots: number;
  /**
   * PRIMEIRA camada da skin da aparência (`ActorBuffer.skin`); pinta e sobe só na primeira vez. Chamar no loading
   * (no Switch, sempre no loading), nunca por frame.
   */
  acquire(recipe: FigureSkinRecipe): number;
  /** Libera um uso da skin (o bobo saiu); ela fica no cache até outra aparência precisar dela. */
  release(firstLayer: number): void;
  /** Esquece tudo (troca de mapa); as camadas da GPU continuam lá, só deixam de valer. */
  clear(): void;
  /** Esquece tudo e chama a opção `release` (fim da partida). Depois disso o cache não pinta mais. */
  dispose(): void;
  readonly stats: SkinLayerCacheStats;
}

export function createFigureSkinCache(options: FigureSkinCacheOptions): FigureSkinCache {
  const cache = createLayerCache<FigureSkinRecipe>(
    { layers: FIGURE_SKIN_LAYERS, bytes: FIGURE_SKIN_BYTES, level1Bytes: FIGURE_SKIN_LEVEL1_BYTES },
    options.firstLayer,
    options.count,
    options.key ?? figureSkinKey,
    options.paint,
    options.write,
  );
  let disposed = false;
  return {
    slots: cache.slots,
    acquire(recipe) {
      if (disposed) throw new Error('cache de skins: acquire depois do dispose');
      return cache.acquire(recipe);
    },
    release: (layer) => cache.release(layer),
    clear: () => cache.clear(),
    dispose() {
      if (disposed) return;
      disposed = true;
      cache.clear();
      options.release?.();
    },
    get stats(): SkinLayerCacheStats {
      return cache.stats;
    },
  };
}

interface LayerCacheShape {
  /** Camadas por skin e bytes do nível 0 e do nível 1 de uma skin. */
  readonly layers: number;
  readonly bytes: number;
  readonly level1Bytes: number;
}

/** A política comum: chave, contagem de uso, reaproveitamento e estouro (a skin menos recente é dividida). */
function createLayerCache<R>(
  shape: LayerCacheShape,
  firstLayer: number,
  layers: number,
  keyOf: (recipe: R) => string,
  compose: (recipe: R, out: Uint8Array, level1: Uint8Array) => void,
  write: (firstLayer: number, rgba: Uint8Array, level1: Uint8Array) => void,
): {
  readonly slots: number;
  acquire(recipe: R): number;
  release(firstLayer: number): void;
  clear(): void;
  readonly stats: SkinLayerCacheStats;
} {
  const per = shape.layers;
  const count = Math.floor(layers / per);
  if (count <= 0) throw new Error(`cache de skins sem reserva: ${layers} camadas, uma skin usa ${per}`);
  const scratch = new Uint8Array(shape.bytes);
  const scratchLevel1 = new Uint8Array(shape.level1Bytes);
  const keys: (string | null)[] = new Array<string | null>(count).fill(null);
  const refs = new Int32Array(count);
  const lastUse = new Float64Array(count);
  const byKey = new Map<string, number>();
  let tick = 0;
  const stats = { used: 0, composed: 0, hits: 0, overflows: 0 };

  const layerOf = (slot: number): number => firstLayer + slot * per;

  /** Skin livre: nunca usada; senão a sem uso há mais tempo; senão (tudo em uso) a menos recente. */
  function pickSlot(): { slot: number; overflow: boolean } {
    let free = -1;
    let idle = -1;
    let oldest = 0;
    for (let s = 0; s < count; s++) {
      if (keys[s] === null) {
        free = s;
        break;
      }
      if (refs[s] === 0 && (idle < 0 || lastUse[s]! < lastUse[idle]!)) idle = s;
      if (lastUse[s]! < lastUse[oldest]!) oldest = s;
    }
    if (free >= 0) return { slot: free, overflow: false };
    if (idle >= 0) return { slot: idle, overflow: false };
    return { slot: oldest, overflow: true };
  }

  return {
    slots: count,
    acquire(recipe) {
      const key = keyOf(recipe);
      tick++;
      const known = byKey.get(key);
      if (known !== undefined) {
        refs[known]!++;
        lastUse[known] = tick;
        stats.hits++;
        return layerOf(known);
      }
      const { slot, overflow } = pickSlot();
      if (overflow) {
        // Sem skin sobrando: divide a menos recente (visual errado é melhor que tela preta) e conta no relatório.
        stats.overflows++;
        refs[slot]!++;
        lastUse[slot] = tick;
        return layerOf(slot);
      }
      const previous = keys[slot];
      if (previous !== null && previous !== undefined) byKey.delete(previous);
      else stats.used++;
      keys[slot] = key;
      byKey.set(key, slot);
      refs[slot] = 1;
      lastUse[slot] = tick;
      scratch.fill(0);
      scratchLevel1.fill(0);
      compose(recipe, scratch, scratchLevel1);
      write(layerOf(slot), scratch, scratchLevel1);
      stats.composed++;
      return layerOf(slot);
    },
    release(layer) {
      const offset = layer - firstLayer;
      if (offset < 0 || offset % per !== 0) return;
      const slot = offset / per;
      if (slot >= count) return;
      if (refs[slot]! > 0) refs[slot]!--;
    },
    clear() {
      keys.fill(null);
      refs.fill(0);
      lastUse.fill(0);
      byKey.clear();
      stats.used = 0;
    },
    get stats(): SkinLayerCacheStats {
      return stats;
    },
  };
}
