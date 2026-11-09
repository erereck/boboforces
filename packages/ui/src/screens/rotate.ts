import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * M2 (fase 4h): "Gire o celular" (gameplay.md §2.5): no celular em retrato, por cima de tudo (a partida pausa). Um
 * celular deitado desenhado com caixas (a tela em âmbar) e o pedido. Sem botão: some quando o aparelho deita.
 */
export const rotateScreen: Screen<null> = {
  id: 'rotate',
  build() {
    const phone: UiNode = {
      kind: 'box',
      id: 'phone',
      width: 220,
      height: 116,
      color: COLORS.linha,
      chamfer: true,
      children: [{ kind: 'box', id: 'phoneScreen', anchor: 'center', width: 184, height: 84, color: COLORS.acao }],
    };
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.bunker,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'center',
          align: 'center',
          gap: 24,
          children: [
            phone,
            { kind: 'text', id: 'rotate', text: { key: 'device.rotatePhone' }, style: 'title', color: COLORS.texto },
            {
              kind: 'text',
              id: 'rotateHint',
              text: { key: 'device.rotateHint' },
              style: 'body',
              color: COLORS.textoBaixo,
              textAlign: 'center',
            },
          ],
        },
      ],
    };
  },
};
