import { CHAOS_SQUEEZE, METRICS } from '@boboforces/sim';

/**
 * M9 (fase 1b): o tamanho dos corpos no desenho. A sim dá a escala de agora de cada corpo (`SimView.chaosScale`: o Mini,
 * o bot gigante e o aperto dele debaixo de teto baixo), que pula quando o gigante passa por uma porta. O desenho anda
 * até ela no máximo a estas velocidades (escala por segundo): encolhe rápido (o gigante entrando debaixo da laje fica
 * dentro dela no máximo ~0,2 s) e cresce um pouco mais devagar (saindo, ele estica sem estalo, em ~0,25 s de 1,2 a 3).
 * A sim não espera o desenho: a hitbox é a da escala de agora, então o crescer é curto (revisão: a 3/s, a hitbox ficava
 * até 0,67 s maior que o boneco). Quando a escala da MÁSCARA muda (a Roleta liga ou desliga um tamanho), o desenho
 * pula direto (`snap`): é a hitbox inteira mudando de uma vez, não uma porta.
 */
export const BODY_SCALE_FOLLOW = { shrinkPerS: 10, growPerS: 8 } as const;

/**
 * A escala desenhada `cur` andando até `target` em `dt` segundos (`BODY_SCALE_FOLLOW`). `cur` ≤ 0 = sem desenho antes;
 * `snap` = vai direto (a escala da máscara mudou).
 */
export function approachScale(cur: number, target: number, dt: number, snap = false): number {
  if (cur <= 0 || snap) return target;
  if (cur > target) {
    const next = cur - BODY_SCALE_FOLLOW.shrinkPerS * dt;
    return next < target ? target : next;
  }
  const next = cur + BODY_SCALE_FOLLOW.growPerS * dt;
  return next > target ? target : next;
}

/**
 * M9 (fase 1b): a câmera em (cx, cy, cz) está dentro do corpo de escala `scale` com os pés em (x, y, z)? O cilindro do
 * tronco (a meia largura da caixa de colisão vezes a escala, mais `nearM` do plano perto da câmera) da sola até o topo
 * do desenho (`CHAOS_SQUEEZE.topM` vezes a escala). Com a colisão normal o gigante encosta no jogador (os eixos a
 * 0,6 m) ou pisa na cabeça dele: a câmera fica dentro da perna ou do tronco, e a vista em 1ª pessoa esconde esse corpo.
 */
export function cameraInsideBody(
  cx: number,
  cy: number,
  cz: number,
  x: number,
  y: number,
  z: number,
  scale: number,
  nearM = 0.1,
): boolean {
  const r = (METRICS.aabbWidth / 2) * scale + nearM;
  const dx = cx - x;
  const dz = cz - z;
  if (dx * dx + dz * dz > r * r) return false;
  return cy > y - nearM && cy < y + CHAOS_SQUEEZE.topM * scale + nearM;
}
