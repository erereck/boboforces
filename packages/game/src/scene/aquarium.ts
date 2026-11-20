import type { BotRef, MatchRecipe, PlatformFamily, TeamRecipe } from '@boboforces/format';
import { ENTITY_FLAG, ENTITY_KIND, type SimView } from '@boboforces/sim';
import {
  COLORS,
  drawText,
  measureText,
  pushRect,
  t,
  withAlpha,
  type DrawList,
  type MsdfFont,
  type StringKey,
  type UiNode,
} from '@boboforces/ui';
import { PAUSE_ACTION } from '../pause.ts';

/**
 * M7 (fase 9): o Aquário (gameplay.md §6.9, GDD §4.4.5). Assistir uma partida só de bots, em qualquer modo, fora do
 * online:
 * - a câmera segue um bot (3ª pessoa), fica nos olhos dele (1ª), voa livre ou olha de cima;
 * - a lista de jogadores grande fica ligada ou desligada;
 * - o tempo anda de 0,25× a 4× no PC e até 2× no celular e no Switch. O passo fixo faz no máximo 4 ticks por frame:
 *   4× a 60 fps e 2× a 30 fps cabem, e abaixo disso a aceleração fica no teto sem avisar;
 * - dá para assumir um bot no meio, com a posição, a vida e a arma dele. Voltar a assistir devolve o bot para a IA.
 */

/** As câmeras, na ordem em que o botão da câmera troca. */
export const AQUARIUM_CAMERA = { follow: 0, eyes: 1, free: 2, top: 3 } as const;
export type AquariumCamera = (typeof AQUARIUM_CAMERA)[keyof typeof AQUARIUM_CAMERA];
const CAMERA_COUNT = 4;

export function nextAquariumCamera(c: AquariumCamera): AquariumCamera {
  return ((c + 1) % CAMERA_COUNT) as AquariumCamera;
}

/** As velocidades (gameplay.md §6.9). O teto do aparelho corta a lista (`aquariumMaxSpeed`). */
export const AQUARIUM_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** DECISOES #? / gameplay.md §6.9: 4× no PC; 2× no celular e no Switch (o passo fixo e a CPU sem JIT). */
export function aquariumMaxSpeed(family: PlatformFamily): number {
  return family === 'pc' ? 4 : 2;
}

/** A próxima velocidade da lista (dá a volta no fim ou no teto). */
export function nextAquariumSpeed(current: number, max: number): number {
  for (const s of AQUARIUM_SPEEDS) if (s > current && s <= max) return s;
  return AQUARIUM_SPEEDS[0];
}

/** "0,25×", "1×" (vírgula do pt-BR, sem `Intl`: regra 13). */
export function aquariumSpeedText(speed: number): string {
  return `${String(speed).replace('.', ',')}×`;
}

export const AQUARIUM = {
  /** A câmera livre voa a isto (m/s); correndo, 3× mais rápido. */
  flyMps: 12,
  flyFastMul: 3,
  /** Folga da câmera livre fora da área jogável e acima do teto do mapa (m). */
  flyMarginM: 20,
  /** A câmera de cima: a altura sobre o bot seguido (m) e o quanto ela olha para baixo (rad). */
  topHeightM: 24,
  topPitch: -1.35,
  /** Com o bot seguido morto há isto (s), a câmera passa para quem matou (ou o próximo vivo). */
  switchAfterDeadS: 3.5,
} as const;

/**
 * A receita só de bots: o lugar do jogador vira um bot no mesmo time, com o 1º bot daquele time (ou `ref`). Assim os
 * times ficam do mesmo tamanho e o Royale continua com 24. O teto do aparelho corta depois, no validador, como sempre.
 */
export function spectateRecipe(recipe: MatchRecipe, ref: BotRef): MatchRecipe {
  let left = 1;
  const teams: TeamRecipe[] = recipe.teams.map((team) => {
    const want = team.humans === 'all' ? left : Math.min(team.humans ?? 0, left);
    left -= want;
    const { humans: _humans, ...rest } = team;
    if (want <= 0) return rest;
    return { ...rest, bots: [{ ref: team.bots[0]?.ref ?? ref, count: want }, ...team.bots] };
  });
  if (left > 0 && teams[0])
    teams[0] = { ...teams[0], bots: [{ ref: teams[0].bots[0]?.ref ?? ref, count: left }, ...teams[0].bots] };
  return { ...recipe, teams };
}

/** O bobo vivo (índice) depois de `from` na direção `dir`, dando a volta; -1 = nenhum vivo. */
export function nextLivingBobo(v: SimView, from: number, dir: 1 | -1): number {
  const n = v.count;
  if (n <= 0) return -1;
  let i = from < 0 || from >= n ? (dir > 0 ? -1 : n) : from;
  for (let k = 0; k < n; k++) {
    i = (i + dir + n) % n;
    if (i === from) break;
    if (livingBobo(v, i)) return i;
  }
  return from >= 0 && from < n && livingBobo(v, from) ? from : -1;
}

export function livingBobo(v: SimView, i: number): boolean {
  return v.alive[i] === 1 && v.kind[i] === ENTITY_KIND.bobo && (v.flags[i]! & ENTITY_FLAG.dead) === 0;
}

/** Posição da câmera livre (o yaw e o pitch são os do mapeador do P1). */
export interface FlyCamera {
  x: number;
  y: number;
  z: number;
}

/** Limites da câmera livre (m). */
export interface FlyBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * Um passo da câmera livre: para a frente na direção do olhar (com o pitch), de lado no plano do chão e `up` (−1..1)
 * na vertical. Yaw 0 olha para −Z (a direita é +X), como a câmera de ombro.
 */
export function stepFlyCamera(
  cam: FlyCamera,
  yaw: number,
  pitch: number,
  moveX: number,
  moveY: number,
  up: number,
  fast: boolean,
  dt: number,
  b: Readonly<FlyBounds>,
): void {
  const d = AQUARIUM.flyMps * (fast ? AQUARIUM.flyFastMul : 1) * dt;
  const cp = Math.cos(pitch);
  const fx = -Math.sin(yaw) * cp;
  const fy = Math.sin(pitch);
  const fz = -Math.cos(yaw) * cp;
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  cam.x = Math.min(b.maxX, Math.max(b.minX, cam.x + (fx * moveY + rx * moveX) * d));
  cam.y = Math.min(b.maxY, Math.max(b.minY, cam.y + (fy * moveY + up) * d));
  cam.z = Math.min(b.maxZ, Math.max(b.minZ, cam.z + (fz * moveY + rz * moveX) * d));
}

/**
 * M9 (fase 5, revisão): onde a faixa do Aquário começa (px da superfície), a mesma conta do `drawAquariumBar`: o que
 * fica em cima dela (a faixa da ferramenta do dono) termina antes.
 */
export function aquariumBarTop(hint: string, height: number, scale: number, minTextPx: number): number {
  const px = Math.max(Math.round(15 * scale), minTextPx);
  const hintPx = Math.max(Math.round(11 * scale), minTextPx);
  const h1 = Math.round(px * 1.7);
  const h2 = hint === '' ? 0 : Math.round(hintPx * 1.7);
  return height - Math.round(Math.max(18 * scale, 8)) - h2 - h1;
}

/**
 * A faixa do Aquário embaixo, no meio: a linha do estado ("AQUÁRIO · 2× · SEGUINDO JORGE") e a dos botões, menor. Não
 * aloca (os textos vêm prontos e só mudam quando o estado muda).
 */
export function drawAquariumBar(
  out: DrawList,
  font: MsdfFont | null,
  status: string,
  hint: string,
  width: number,
  height: number,
  scale: number,
  minTextPx: number,
): void {
  if (font === null) return;
  const px = Math.max(Math.round(15 * scale), minTextPx);
  const hintPx = Math.max(Math.round(11 * scale), minTextPx);
  const pad = Math.round(px * 0.5);
  const w1 = measureText(font, status, px, 0.06) + pad * 2;
  const w2 = hint === '' ? 0 : measureText(font, hint, hintPx, 0.02) + pad * 2;
  const h2 = hint === '' ? 0 : Math.round(hintPx * 1.7);
  const y1 = aquariumBarTop(hint, height, scale, minTextPx);
  const h1 = Math.round(px * 1.7);
  const y2 = y1 + h1;
  const x1 = Math.round((width - w1) / 2);
  pushRect(out, x1, y1, w1, h1, withAlpha(COLORS.bunker, 0.85));
  pushRect(out, x1, y1, w1, Math.max(2, Math.round(2 * scale)), COLORS.acao);
  drawText(out, font, status, x1 + pad, y1 + px * 0.42, px, COLORS.texto, 0.06);
  if (hint === '') return;
  const x2 = Math.round((width - w2) / 2);
  pushRect(out, x2, y2, w2, h2, withAlpha(COLORS.bunker, 0.7));
  drawText(out, font, hint, x2 + pad, y2 + hintPx * 0.42, hintPx, COLORS.textoBaixo, 0.02);
}

type ButtonText = { readonly key: StringKey; readonly params?: Readonly<Record<string, string | number>> };

/** As ações dos itens do Aquário na pausa. */
export const AQUARIUM_ACTION = { speed: 'aq.speed', take: 'aq.take', watch: 'aq.watch', list: 'aq.list' } as const;

/** O que a pausa do Aquário mostra. */
export interface AquariumPause {
  readonly speed: string;
  readonly piloting: boolean;
  readonly canTake: boolean;
  readonly challenge: boolean;
  /** A lista grande ligada (o item da pausa a liga e desliga: o toque não tem o botão do placar). */
  readonly list: boolean;
}

function item(id: string, text: ButtonText, action: string, extra: Partial<UiNode> = {}): UiNode {
  return { kind: 'button', id, text, action, variant: 'secondary', ...extra } as UiNode;
}

/**
 * Os itens do P1 na pausa do Aquário. Assistindo: a velocidade (cada aperto passa para a próxima), assumir o bobo
 * seguido, a lista grande, os ajustes e sair (a dificuldade fica para o bot assumido e o resultado: 6 itens cabem no
 * celular). Com um bot assumido: voltar a assistir no lugar da velocidade.
 */
export function aquariumPauseItems(p: AquariumPause): UiNode[] {
  const challenge = item('challenge', { key: 'pause.challenge' }, PAUSE_ACTION.challenge, { disabled: !p.challenge });
  const settings = item('settings', { key: 'menu.settings' }, PAUSE_ACTION.settings);
  const quit = item('quit', { key: 'pause.quitMatch' }, PAUSE_ACTION.quit, { variant: 'danger' });
  if (p.piloting) {
    return [
      item('watch', { key: 'pause.aquarium.watch' }, AQUARIUM_ACTION.watch),
      challenge,
      settings,
      item('unstuck', { key: 'pause.unstuck' }, PAUSE_ACTION.unstuck),
      quit,
    ];
  }
  return [
    item('speed', { key: 'pause.aquarium.speed', params: { speed: p.speed } }, AQUARIUM_ACTION.speed),
    item('take', { key: 'pause.aquarium.take' }, AQUARIUM_ACTION.take, { disabled: !p.canTake }),
    item('list', { key: p.list ? 'pause.aquarium.listOff' : 'pause.aquarium.listOn' }, AQUARIUM_ACTION.list),
    settings,
    quit,
  ];
}

/** A frase de ajuda dos itens do Aquário (`null` = é um item de sempre: `pauseHelp`). */
export function aquariumPauseHelp(focusedId: string | null): string | null {
  if (focusedId === 'speed') return t('pause.help.speed');
  if (focusedId === 'take') return t('pause.help.take');
  if (focusedId === 'watch') return t('pause.help.watch');
  if (focusedId === 'list') return t('pause.help.list');
  return null;
}
