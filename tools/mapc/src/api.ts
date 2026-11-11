import type {
  MapCamera,
  MapCameraRoute,
  MapBarricadeMarker,
  MapMannequin,
  MapPaidDoorMarker,
  MapWallBuyMarker,
  MapMeta,
  MapPointMarker,
  MapSpawnMarker,
  PropDose,
  TimeOfDay,
} from '@boboforces/format';
import type { Rng } from '@boboforces/shared';
import type { BlockShape } from '@boboforces/world';

/**
 * API de construção dos mapas (tecnico.md §15.1, GDD §4.6.5, arte-ux.md §5.7). A frente "mapa-nav" é dona desta API
 * (só o `.bfmap` é contrato). O script do mapa recebe um `MapBuilder` e chama `box`, `ramp`, `stairs`, `fence`,
 * `prop`, `spawn`…
 *
 * Unidades: CÉLULAS de 0,5 m (inteiros) para a grade, com caixas INCLUSIVAS e cantos em qualquer ordem; METROS (e
 * radianos) para props e marcadores. Eixos do shared: Y para cima; yaw 0 olha para -Z; yaw + vira à esquerda.
 * Bloco = ID de conteúdo sem prefixo (`concrete`); `null` = ar.
 */

/** Para onde a rampa/escada SOBE (o "alto" da forma canônica fica em -Z: giro 0). */
export type RampDir = '-z' | '-x' | '+z' | '+x';

/** Giro (quartos anti-horários vistos de cima) que leva o "alto" canônico (-Z) para `dir`. */
export const RAMP_DIR_ROTATION: Readonly<Record<RampDir, number>> = { '-z': 0, '-x': 1, '+z': 2, '+x': 3 };

/** Blocos de uma família de rampas e escadas (todos do mesmo material). */
export interface RampFamily {
  /** Cubo do apoio embaixo da rampa. */
  readonly solid: string;
  /** Rampa 1:1. */
  readonly ramp?: string;
  /** Rampa 1:2: meia baixa e meia alta. */
  readonly halfLow?: string;
  readonly halfHigh?: string;
  /** Degrau (escada de 0,25 m por degrau). */
  readonly step?: string;
}

/** Porta registrada (`door`): o `mapc` confere largura, altura, alinhamento e a navegação de um lado ao outro. */
export interface DoorRecord {
  /** Primeira célula da abertura (canto mínimo) e a base (piso da porta). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Eixo ao longo da parede: a abertura tem `width` células nesse eixo e atravessa `thickness` no outro. */
  readonly along: 'x' | 'z';
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
}

export interface MapBuilder {
  meta(meta: MapMeta): void;
  /** Tamanho da grade em células (chame antes de tudo). */
  size(x: number, y: number, z: number): void;
  /** Bloco numa célula (sobrescreve; fora da grade é erro). `rot` em quartos de volta, `flip` = de cabeça para baixo. */
  set(x: number, y: number, z: number, block: string | null, rot?: number, flip?: boolean): void;
  /** Bloco da célula (`null` = ar ou fora da grade). */
  get(x: number, y: number, z: number): string | null;
  /** Caixa cheia (inclusiva). `null` esvazia. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: string | null, rot?: number): void;
  /** Como `box`, mas só onde está vazio (terreno, mato). */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: string): void;
  /** Só as 4 paredes laterais da caixa (sem piso nem teto). */
  walls(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: string): void;
  /**
   * Rampa na pegada [x0..x1]×[z0..z1] subindo para `dir` a partir do piso `y0` (a primeira célula de rampa fica em
   * `y0`): 1:1 sobe 1 célula por célula; 1:2 sobe 1 célula a cada 2 (meia baixa + meia alta). O apoio embaixo é
   * `family.solid`. Devolve o y do topo (célula logo acima do último nível).
   */
  ramp(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    z1: number,
    family: RampFamily,
    dir: RampDir,
    slope: '1:1' | '1:2',
  ): number;
  /** Escada de degraus (`family.step`, 0,25 m por meio degrau) na pegada, subindo para `dir`; mesma regra da rampa. */
  stairs(x0: number, y0: number, z0: number, x1: number, z1: number, family: RampFamily, dir: RampDir): number;
  /**
   * Cerca/corrimão (forma painel ou poste + travessa) numa linha reta de (x0, z0) a (x1, z1) (x0 = x1 ou z0 = z1),
   * da altura `y` até `y + height - 1`. O giro segue a direção da linha.
   */
  fence(x0: number, y: number, z0: number, x1: number, z1: number, block: string, height?: number): void;
  /** Plano de painéis finos (vidro, tela): a caixa precisa ter 1 célula de espessura em X ou em Z. */
  panel(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: string): void;
  /** Vegetação em cruz numa célula vazia (só se a de baixo for sólida). Devolve se plantou. */
  cross(x: number, y: number, z: number, block: string): boolean;
  /**
   * Porta: abre `width` × `height` células (padrão 2 × 4 = 1,0 × 2,0 m) na parede a partir de (x, y, z), ao longo de
   * `along`, atravessando `thickness` células, e registra para a validação.
   */
  door(x: number, y: number, z: number, along: 'x' | 'z', thickness?: number, width?: number, height?: number): void;
  /** Prop fora da grade: modelo (ID sem prefixo), pivô em metros, giro em rad, escala (1 = 100%) e dose. */
  prop(model: string, x: number, y: number, z: number, yaw: number, scale?: number, dose?: PropDose): void;
  spawn(marker: MapSpawnMarker): void;
  domination(point: MapPointMarker): void;
  camera(camera: MapCamera): void;
  route(route: MapCameraRoute): void;
  mannequin(mannequin: MapMannequin): void;
  /** M3 (fase 3d): janela com barricada do Bobo Zombies (o vão precisa estar livre na grade; metros). */
  barricade(window: MapBarricadeMarker): void;
  /** M3 (fase 3d): porta paga do Bobo Zombies (a caixa que fecha a passagem livre na grade; metros). */
  paidDoor(door: MapPaidDoorMarker): void;
  /** M3 (fase 4a): arma na parede do Bobo Zombies (ponto na face da parede, na altura do chão; metros). */
  wallBuy(buy: MapWallBuyMarker): void;
  playArea(minX: number, minZ: number, maxX: number, maxZ: number, killPlaneY: number): void;
  sun(dirX: number, dirY: number, dirZ: number, timeOfDay: TimeOfDay): void;
  /** RNG com semente por domínio (decoração procedural determinística). */
  rng(domain: string): Rng;
}

/** Um mapa é um módulo que exporta um `MapScript`. */
export interface MapScript {
  readonly id: string;
  build(b: MapBuilder): void;
}

/** Formas que cada operação exige do bloco (conferidas contra o registro real no `mapc`). */
export type ShapeRequirement = ReadonlyMap<string, ReadonlySet<BlockShape>>;
