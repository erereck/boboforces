import type { MapBuilder, MapScript, RampFamily } from '../../tools/mapc/src/api.ts';
import { barnDoor } from './kit.ts';

/**
 * FAZENDA À NOITE (nome provisório "Fazenda", pergunta AK2; M10, fase 5): o 2º mapa do Bobo Zombies (e do Fortress),
 * grande. Grade de 120×20×120 m (240×40×240 células), área jogável de 100×100 m (x, z de 10 a 110) cercada por uma
 * cerca viva de 3 m. No meio, o conjunto da fazenda (x 28..96, z 28..88), cercado por campos onde os zumbis nascem:
 * - CASA (x 50..68, z 74..88): onde os bobos nascem; sala e cozinha ligadas por um vão; 3 janelas (2 para a varanda
 *   do sul, 1 a leste); Door Knocker e Buzzer; a Caixa Misteriosa começa aqui. Duas portas: a escolha do começo.
 * - TERREIRO (x 50..76, z 52..74), ao norte da casa, pela porta de 750: o poço, o galinheiro, os fardos, a lenha e a
 *   Rattler na parede dos fundos da casa; 2 janelas.
 * - GALPÃO DE MÁQUINAS (x 28..50, z 60..88), a oeste da casa, pela porta de 1000: o trator na baia de tela, a carroça,
 *   a Lawnmower e a Chonky Cola; 4 janelas; uma 2ª porta de 750 liga o galpão ao terreiro (dá a volta).
 * - CELEIRO (x 44..76, z 28..52), ao norte do terreiro, pelo portão de 1250: o jirau de feno a 3 m (escada de tábua),
 *   a Peekaboo lá em cima, as baias no meio, a selaria, a Buddy Brew e a 2ª posição da caixa; 4 janelas.
 * - PÁTIO DOS SILOS (x 76..96, z 28..70), a leste, pela porta de 1000 do terreiro (e pela de 750 do celeiro): os dois
 *   silos nos cantos do norte e, no meio, a casa de máquinas, a moega e o graneleiro: a volta para o "trenzinho" de
 *   zumbis; Speedy Soda, uma 2ª Rattler e a 3ª posição da caixa; 5 janelas.
 * A maior linha de visão (49,7 m, medida pelo `mapc`) é cortada por fardos de feno: a medida conta só bloco cheio (os
 * silos e o trator, props, não contam), então cada janela e cada porta tem um fardo, uma pilha ou uma baia na reta.
 * - FORA: o milharal ao norte, o cata-vento no canto noroeste, o pomar e o açude a oeste, o pasto a leste e o terreiro
 *   da frente com a estrada ao sul (os zumbis nascem nos campos do sul e do leste, perto da casa). Cercas vivas de
 *   2,5 m dividem os campos (com passagem alternada: nenhuma reta passa dos 50 m do Switch 3–4P).
 * - SEM POLEIRO (revisão da fase 5): o bobo escala até 1,55 m e o zumbi só sobe 1 m e só bate até 1 m de altura. Onde o
 *   bobo pisa nada passa de 1 m; as pilhas de 2 m ficam fora do alcance do pulo de qualquer degrau e a 3 m das
 *   paliçadas; trator e rolos de feno (que dão para escalar) só nos campos, e o do galpão atrás da tela (o teste
 *   `farm.test.ts` confere que nenhum ponto alcançável pelo bobo fica longe do alcance do zumbi).
 *
 * À noite: a lua, lâmpadas nas paredes e nos tetos, a da varanda e holofotes de pé nos campos. Tudo em METROS aqui
 * (múltiplos de 0,5); o builder recebe células. Caixas semiabertas [a, b). Paredes de 0,5 m na "linha" (de a a a + 0,5).
 * Vãos de 1 m começam em metro inteiro (a grade de navegação é de 1 m).
 *
 * A FAZER: o Fortress roda aqui (a receita com `zombies.variant: 'fortress'` e `map: 'farm'`; o gerador sai dos spawns
 * da casa), mas nenhum card o oferece na Fazenda: o card Fortaleza é fixo no Posto (more-modes.ts) e o Surpreenda-me
 * não sorteia mapa para ele. Oferecer pede decidir o card (pergunta para o Erick), não só dado.
 */

const c = (m: number): number => Math.round(m * 2);
const G = 1;
const SIZE = 120;
const MIN_X = 10;
const MAX_X = 110;
const MIN_Z = 10;
const MAX_Z = 110;
/** Alturas das paredes (m): a casa, o celeiro, o galpão e a paliçada dos terreiros. */
const CASA_H = 3.5;
const BARN_H = 6.5;
const SHED_H = 4.5;
const YARD_H = 3;
/** Vão das janelas e das portas pagas (m). */
const GAP_H = 2;
/** O jirau de feno do celeiro: piso (m) e o fundo (z). */
const LOFT_Y = G + 3;
const LOFT_Z1 = 34.5;

type Side = 0 | 1 | 2 | 3;

function yawTo(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

function pitchTo(x: number, y: number, z: number, tx: number, ty: number, tz: number): number {
  return Math.atan2(ty - y, Math.hypot(tx - x, tz - z));
}

/** Caixa [x0, x1) × [y0, y1) × [z0, z1) em metros. */
function box(
  b: MapBuilder,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  block: string | null,
): void {
  b.box(c(x0), c(y0), c(z0), c(x1) - 1, c(y1) - 1, c(z1) - 1, block);
}

/** Parede de 0,5 m na linha x = `x` (de x a x + 0,5), de z0 a z1, com `h` m de altura. */
function wallZ(b: MapBuilder, x: number, z0: number, z1: number, h: number, block: string): void {
  box(b, x, G, z0, x + 0.5, G + h, z1, block);
}

/** Parede de 0,5 m na linha z = `z` (de z a z + 0,5), de x0 a x1, com `h` m de altura. */
function wallX(b: MapBuilder, z: number, x0: number, x1: number, h: number, block: string): void {
  box(b, x0, G, z, x1, G + h, z + 0.5, block);
}

/** Uma abertura numa parede: a linha da parede, o centro ao longo dela e se a parede corre em X. */
interface Opening {
  readonly line: number;
  readonly at: number;
  readonly alongX: boolean;
  /** Moldura em volta do vão (null = sem moldura). */
  readonly frame: string | null;
}

interface Window extends Opening {
  readonly outside: Side;
}

interface Door extends Opening {
  readonly cost: number;
}

/** Caixa na parede da abertura: [a0, a1) ao longo dela, [y0, y1) de altura. */
function inWall(b: MapBuilder, o: Opening, a0: number, a1: number, y0: number, y1: number, block: string | null): void {
  if (o.alongX) box(b, a0, y0, o.line, a1, y1, o.line + 0.5, block);
  else box(b, o.line, y0, a0, o.line + 0.5, y1, a1, block);
}

/** Abre o vão de `w` m (moldura de 0,5 m dos lados e em cima, se houver). */
function carve(b: MapBuilder, o: Opening, w: number): void {
  const h = w / 2;
  if (o.frame !== null) {
    inWall(b, o, o.at - h - 0.5, o.at - h, G, G + GAP_H + 0.5, o.frame);
    inWall(b, o, o.at + h, o.at + h + 0.5, G, G + GAP_H + 0.5, o.frame);
    inWall(b, o, o.at - h, o.at + h, G + GAP_H, G + GAP_H + 0.5, o.frame);
  }
  inWall(b, o, o.at - h, o.at + h, G, G + GAP_H, null);
}

// Molduras: tábua branca na casa e no celeiro, tora na paliçada, nada no galpão de chapa.
const TRIM = 'wood-trim';
const LOG = 'log';

/** As janelas (barricadas de 6 tábuas): 18, todas viradas para os campos. */
const WINDOWS: readonly Window[] = [
  // Casa: 2 para a varanda (sul) e 1 a leste.
  { line: 88, at: 54.5, alongX: true, outside: 2, frame: TRIM },
  { line: 88, at: 64.5, alongX: true, outside: 2, frame: TRIM },
  { line: 68, at: 77.5, alongX: false, outside: 0, frame: TRIM },
  // Galpão: 2 a oeste, 1 ao norte e 1 ao sul.
  { line: 28, at: 66.5, alongX: false, outside: 1, frame: null },
  { line: 28, at: 81.5, alongX: false, outside: 1, frame: null },
  { line: 60, at: 46.5, alongX: true, outside: 3, frame: null },
  { line: 88, at: 45.5, alongX: true, outside: 2, frame: null },
  // Terreiro: 1 a oeste e 1 ao sul (o canto do pomar e o da horta).
  { line: 50, at: 56.5, alongX: false, outside: 1, frame: LOG },
  { line: 74, at: 70.5, alongX: true, outside: 2, frame: LOG },
  // Celeiro: 3 ao norte e 1 a oeste, todas debaixo do jirau (o canto sudoeste é a selaria fechada).
  { line: 28, at: 49.5, alongX: true, outside: 3, frame: TRIM },
  { line: 28, at: 65.5, alongX: true, outside: 3, frame: TRIM },
  { line: 28, at: 71.5, alongX: true, outside: 3, frame: TRIM },
  { line: 44, at: 31.5, alongX: false, outside: 1, frame: TRIM },
  // Pátio dos silos: 1 ao norte, 3 a leste e 1 ao sul.
  { line: 28, at: 86.5, alongX: true, outside: 3, frame: LOG },
  { line: 96, at: 34.5, alongX: false, outside: 0, frame: LOG },
  { line: 96, at: 43.5, alongX: false, outside: 0, frame: LOG },
  { line: 96, at: 62.5, alongX: false, outside: 0, frame: LOG },
  { line: 70, at: 89.5, alongX: true, outside: 2, frame: LOG },
];

/** Portas pagas de 2 m (GDD §4.1.5: 750–1250). */
const DOORS: readonly Door[] = [
  // Casa → terreiro (fundos) e casa → galpão: a escolha do começo.
  { line: 74, at: 55, alongX: true, cost: 750, frame: TRIM },
  { line: 50, at: 77, alongX: false, cost: 1000, frame: null },
  // Galpão → terreiro (a volta pelo oeste).
  { line: 50, at: 67, alongX: false, cost: 750, frame: null },
  // Terreiro → celeiro (o portão grande).
  { line: 52, at: 63, alongX: true, cost: 1250, frame: TRIM },
  // Terreiro → pátio dos silos e celeiro → pátio dos silos.
  { line: 76, at: 63, alongX: false, cost: 1000, frame: LOG },
  { line: 76, at: 44, alongX: false, cost: 750, frame: TRIM },
];

const ROOF_CASA: RampFamily = { solid: 'siding', ramp: 'metal-roof-ramp' };
const ROOF_BARN: RampFamily = { solid: 'barn-wood', ramp: 'metal-roof-ramp' };
const ROOF_SHED: RampFamily = { solid: 'metal-panel', ramp: 'metal-roof-ramp' };

/**
 * Telhado de chapa de duas águas, truncado: rampas 1:1 nos lados de z (subindo para dentro) por `rise` m e o topo
 * plano (chapa xadrez). O apoio das rampas (o sótão) é do material da parede: as empenas leem como parede.
 */
function roof(
  b: MapBuilder,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y0: number,
  rise: number,
  f: RampFamily,
): void {
  const n = c(rise);
  b.ramp(c(x0), c(y0), c(z0), c(x1) - 1, c(z0) + n - 1, f, '+z', '1:1');
  b.ramp(c(x0), c(y0), c(z1) - n, c(x1) - 1, c(z1) - 1, f, '-z', '1:1');
  box(b, x0, y0, z0 + rise, x1, y0 + rise - 0.5, z1 - rise, f.solid);
  box(b, x0, y0 + rise - 0.5, z0 + rise, x1, y0 + rise, z1 - rise, 'metal-panel');
}

function ground(b: MapBuilder): void {
  box(b, 0, 0, 0, SIZE, 0.5, SIZE, 'dirt');
  box(b, 0, 0.5, 0, SIZE, G, SIZE, 'grass');
  // Pisos: tábua na casa e no celeiro, concreto no galpão, terra batida no terreiro, brita no pátio dos silos.
  box(b, 50.5, 0.5, 74.5, 68, G, 88, 'plank');
  box(b, 44.5, 0.5, 28.5, 76, G, 52, 'plank');
  box(b, 28.5, 0.5, 60.5, 50, G, 88, 'concrete');
  box(b, 50.5, 0.5, 52.5, 76, G, 74, 'dirt');
  box(b, 76.5, 0.5, 28.5, 96, G, 70, 'gravel');
  // A varanda (deque de tábua rente ao chão) e a estrada de terra da porteira até ela.
  box(b, 50.5, 0.5, 88.5, 68.5, G, 91.5, 'plank');
  box(b, 57, 0.5, 91.5, 61, G, MAX_Z + 10, 'dirt');
  // A cerca viva da borda (3 m, fora da área jogável) com a porteira fechada na estrada.
  const hedge = (x0: number, z0: number, x1: number, z1: number): void => box(b, x0, G, z0, x1, G + 3, z1, 'leaves');
  hedge(MIN_X - 1, MIN_Z - 1, MAX_X + 1, MIN_Z);
  hedge(MIN_X - 1, MAX_Z, 57, MAX_Z + 1);
  hedge(61, MAX_Z, MAX_X + 1, MAX_Z + 1);
  hedge(MIN_X - 1, MIN_Z - 1, MIN_X, MAX_Z + 1);
  hedge(MAX_X, MIN_Z - 1, MAX_X + 1, MAX_Z + 1);
  b.panel(c(57), c(G), c(MAX_Z), c(61) - 1, c(G + 2) - 1, c(MAX_Z), 'fence-wood');
  box(b, 56.5, G, MAX_Z, 57, G + 2.5, MAX_Z + 1, LOG);
  box(b, 61, G, MAX_Z, 61.5, G + 2.5, MAX_Z + 1, LOG);
}

/** As paredes do conjunto (uma por divisa), com as janelas e as portas abertas. */
function walls(b: MapBuilder): void {
  // Celeiro: tábua vermelha até a beira do telhado.
  wallX(b, 28, 44, 76.5, BARN_H, 'barn-wood');
  wallX(b, 52, 44, 76.5, BARN_H, 'barn-wood');
  wallZ(b, 44, 28, 52.5, BARN_H, 'barn-wood');
  wallZ(b, 76, 28, 52.5, BARN_H, 'barn-wood');
  // Pátio dos silos e terreiro: paliçada de tábua com postes de tora.
  wallX(b, 28, 76.5, 96.5, YARD_H, 'plank');
  wallZ(b, 96, 28, 70.5, YARD_H, 'plank');
  wallX(b, 70, 76.5, 96.5, YARD_H, 'plank');
  wallZ(b, 76, 52.5, 74.5, YARD_H, 'plank');
  wallZ(b, 50, 52.5, 60, YARD_H, 'plank');
  wallX(b, 74, 68.5, 76, YARD_H, 'plank');
  // Galpão: chapa sobre a base de bloco; a divisa com a casa é de tijolo (parede corta-fogo).
  wallZ(b, 28, 60, 88.5, SHED_H, 'metal-panel');
  wallX(b, 60, 28.5, 50.5, SHED_H, 'metal-panel');
  wallX(b, 88, 28.5, 50, SHED_H, 'metal-panel');
  wallZ(b, 50, 60, 74, SHED_H, 'metal-panel');
  wallZ(b, 50, 74, 88.5, SHED_H, 'brick');
  wallZ(b, 28, 60, 88.5, 1, 'cinder-block');
  wallX(b, 60, 28.5, 50.5, 1, 'cinder-block');
  wallX(b, 88, 28.5, 50, 1, 'cinder-block');
  // Casa: lambri creme; a divisória de tábua entre a sala e a cozinha, com o vão de 4 m.
  wallX(b, 74, 50.5, 68.5, CASA_H, 'siding');
  wallX(b, 88, 50.5, 68.5, CASA_H, 'siding');
  wallZ(b, 68, 74.5, 88, CASA_H, 'siding');
  wallZ(b, 60, 74.5, 88, CASA_H, 'plank');
  box(b, 60, G, 80, 60.5, G + 3, 83, null);
  // Cantos de tábua branca na casa e no celeiro; postes de tora na paliçada (a cada 4 m, 0,5 m mais altos).
  for (const [x, z] of [
    [68, 74],
    [68, 88],
    [50, 88],
  ] as const) {
    box(b, x, G, z, x + 0.5, G + CASA_H, z + 0.5, TRIM);
  }
  for (const [x, z] of [
    [44, 28],
    [76, 28],
    [44, 52],
    [76, 52],
  ] as const) {
    box(b, x, G, z, x + 0.5, G + BARN_H, z + 0.5, TRIM);
  }
  const post = (x: number, z: number): void => box(b, x, G, z, x + 0.5, G + YARD_H + 0.5, z + 0.5, LOG);
  for (let x = 80; x < 96; x += 4) {
    post(x, 28);
    post(x, 70);
  }
  for (let z = 32; z < 70; z += 4) post(96, z);
  for (const z of [56, 70]) post(76, z);
  post(96, 28);
  post(96, 70);
  post(50, 52.5);
  post(76, 74);
  // O celeiro por fora: o portão grande do sul (duas folhas em X abertas dos lados da passagem, numa moldura de 10 m),
  // a porta fechada em X do norte e a porta do jirau na empena oeste.
  barnDoor(b, 58.5, G, 52, 'x', 3, 3);
  barnDoor(b, 64.5, G, 52, 'x', 3, 3);
  box(b, 58, G, 52, 58.5, G + 3.5, 52.5, TRIM);
  box(b, 67.5, G, 52, 68, G + 3.5, 52.5, TRIM);
  box(b, 58, G + 3, 52, 68, G + 3.5, 52.5, TRIM);
  barnDoor(b, 56, G, 28, 'x', 4, 4);
  box(b, 55.5, G, 28, 56, G + 4.5, 28.5, TRIM);
  box(b, 60, G, 28, 60.5, G + 4.5, 28.5, TRIM);
  box(b, 55.5, G + 4, 28, 60.5, G + 4.5, 28.5, TRIM);
  barnDoor(b, 44, G + 3.5, 30, 'z', 3, 2);
  box(b, 44, G + 3, 29.5, 44.5, G + 6, 30, TRIM);
  box(b, 44, G + 3, 33, 44.5, G + 6, 33.5, TRIM);
  box(b, 44, G + 5.5, 30, 44.5, G + 6, 33, TRIM);
  box(b, 44, G + 3, 30, 44.5, G + 3.5, 33, TRIM);
  for (const w of WINDOWS) carve(b, w, 1);
  for (const d of DOORS) carve(b, d, 2);
}

function roofs(b: MapBuilder): void {
  // Casa: beiral de 0,5 m no norte e no sul, 2,5 m de subida e o topo plano; a chaminé de tijolo da lareira.
  roof(b, 50.5, 68.5, 73.5, 89, G + CASA_H, 2.5, ROOF_CASA);
  box(b, 50.5, G, 83, 51.5, G + 0.5, 85, 'brick');
  box(b, 50.5, G + 0.5, 83.5, 51.5, G + CASA_H + 4, 84.5, 'brick');
  // Celeiro: 4 m de subida (o topo a 11,5 m do chão).
  roof(b, 43.5, 77, 27.5, 53, G + BARN_H, 4, ROOF_BARN);
  // Galpão: telhado baixo (1,5 m).
  roof(b, 28, 50.5, 59.5, 89, G + SHED_H, 1.5, ROOF_SHED);
  // A varanda: o telhadinho de tábua em postes de tora.
  box(b, 50.5, G + 3, 88.5, 68.5, G + 3.5, 91.5, 'plank-slab');
  for (const x of [50.5, 56, 62.5, 67.5]) box(b, x, G, 91, x + 0.5, G + 3, 91.5, LOG);
}

function objects(b: MapBuilder): void {
  for (const w of WINDOWS) {
    const x = w.alongX ? w.at : w.line + 0.25;
    const z = w.alongX ? w.line + 0.25 : w.at;
    b.barricade({ x, y: G, z, outside: w.outside, width: 1, height: GAP_H });
  }
  for (const d of DOORS) {
    b.paidDoor({
      minX: d.alongX ? d.at - 1 : d.line,
      minY: G,
      minZ: d.alongX ? d.line : d.at - 1,
      maxX: d.alongX ? d.at + 1 : d.line + 0.5,
      maxY: G + GAP_H,
      maxZ: d.alongX ? d.line + 0.5 : d.at + 1,
      cost: d.cost,
    });
  }
  // Armas na parede (ponto na face de dentro, no chão de quem compra).
  b.wallBuy({ x: 50.5, y: G, z: 80.5, facing: 0, weapon: 'shotgun', cost: 900 });
  b.wallBuy({ x: 61.5, y: G, z: 74.5, facing: 2, weapon: 'smg', cost: 1000 });
  b.wallBuy({ x: 63, y: G, z: 74, facing: 3, weapon: 'rifle', cost: 1200 });
  b.wallBuy({ x: 28.5, y: G, z: 74, facing: 0, weapon: 'lmg', cost: 1500 });
  b.wallBuy({ x: 52, y: LOFT_Y, z: 28.5, facing: 2, weapon: 'sniper', cost: 1000 });
  b.wallBuy({ x: 85.5, y: G, z: 70, facing: 3, weapon: 'rifle', cost: 1200 });
  // A Caixa Misteriosa: começa na sala; pode ir para o celeiro e para o pátio dos silos.
  b.boxSpot({ x: 59.2, y: G, z: 86, facing: 1 });
  b.boxSpot({ x: 75.2, y: G, z: 47.5, facing: 1 });
  b.boxSpot({ x: 83.5, y: G, z: 29.3, facing: 2 });
  // As vantagens.
  b.perkMachine({ x: 31.5, y: G, z: 87.2, facing: 3, perk: 'chonky', cost: 2500 });
  b.perkMachine({ x: 70, y: G, z: 51.2, facing: 3, perk: 'buddy', cost: 1500 });
  b.perkMachine({ x: 95.2, y: G, z: 66.5, facing: 1, perk: 'speedy', cost: 3000 });
}

/** Lâmpada de 0,5 m (luz das salas e dos terreiros à noite). */
function lamp(b: MapBuilder, x: number, y: number, z: number): void {
  box(b, x, y, z, x + 0.5, y + 0.5, z + 0.5, 'lamp');
}

/**
 * A casa por dentro: a lareira, o sofá, a mesa, o balcão e a geladeira; lâmpadas no forro. Regra dos poleiros (vale
 * para o conjunto todo, revisão da fase 5): o bobo escala até 1,55 m e o zumbi só bate até 1 m de altura e só sobe
 * 1 m, então nada onde o bobo pisa passa de 1 m, menos o que fica fora do alcance do pulo de qualquer degrau (as pilhas
 * de 2 m ficam a 4,3 m ou mais de um degrau de 0,5 m, a 3,7 m de um de 1 m) e longe das paliçadas de 3 m.
 */
function casa(b: MapBuilder): void {
  // Sofá de lona (baixo) virado para a lareira e a mesa da cozinha (tampo em pés de tora), longe do armário de 2 m.
  box(b, 54, G, 82, 57, G + 0.5, 83, 'canvas');
  box(b, 64, G, 78.5, 64.5, G + 0.5, 79.5, LOG);
  box(b, 66, G, 78.5, 66.5, G + 0.5, 79.5, LOG);
  box(b, 64, G + 0.5, 78.5, 66.5, G + 1, 79.5, 'plank-slab');
  // Bancada da cozinha (0,5 m, um degrau: mais alta, a navegação perde o nó da cozinha ali e quem sobe nela "fica" do
  // lado do terreiro para os zumbis) encostada na parede norte e na leste; a geladeira de chapa no canto sudeste.
  box(b, 63, G, 74.5, 68, G + 0.5, 75.5, 'plank');
  box(b, 67, G, 86, 68, G + 2, 88, 'metal-panel');
  // O armário de tábua (2 m) encostado na divisória, do lado da cozinha.
  box(b, 60.5, G, 83, 61.5, G + 2, 86, 'plank');
  lamp(b, 55, G + 3, 78);
  lamp(b, 55, G + 3, 85);
  lamp(b, 64, G + 3, 78);
  lamp(b, 64, G + 3, 85);
  // Arandelas nas paredes (a sala é onde se nasce: precisa ler bem as janelas e a caixa).
  lamp(b, 50, G + 2, 87);
  lamp(b, 58, G + 2, 74);
  lamp(b, 68, G + 2, 81.5);
  lamp(b, 62, G + 2, 88);
  lamp(b, 57, G + 2, 88);
  // A luz da varanda, debaixo do telhadinho.
  lamp(b, 59, G + 2.5, 90);
}

/**
 * O galpão de máquinas: o trator na baia de tela (do chão ao forro: dá para ver, não para subir nele), a bancada e os
 * tambores dentro dela, a carroça, caixotes e os painéis de luz embutidos nas paredes.
 */
function galpao(b: MapBuilder): void {
  const wire = (x0: number, z0: number, x1: number, z1: number): void =>
    b.panel(c(x0), c(G), c(z0), c(x1) - 1, c(G + SHED_H) - 1, c(z1) - 1, 'fence-wire');
  wire(33, 60.5, 33.5, 66);
  wire(43.5, 60.5, 44, 66);
  wire(33, 65.5, 44, 66);
  b.prop('tractor', 38.5, G, 63, Math.PI * 0.5, 1, 1);
  box(b, 33.5, G, 60.5, 36.5, G + 1, 61.5, 'plank');
  b.prop('barrel', 42.5, G, 61.5, 0, 1, 1);
  b.prop('barrel', 42.8, G, 62.8, 1, 1, 1);
  box(b, 30, G, 68, 33, G + 2, 72, 'crate');
  // A carroça de feno (leito de 1 m e os fardos até 2 m) e as pilhas de caixote: cortam as retas de janela a porta.
  box(b, 38, G, 83, 41, G + 1, 87, 'plank');
  box(b, 38, G + 1, 83, 41, G + 2, 87, 'hay-bale');
  box(b, 38, G, 70, 41, G + 2, 76, 'crate');
  box(b, 38, G, 76, 41, G + 2, 82, 'hay-bale');
  box(b, 46, G, 63, 49, G + 2, 70, 'crate');
  box(b, 31, G, 80, 32.5, G + 0.5, 82, 'crate');
  // Pilares do telhado.
  for (const z of [68, 80]) box(b, 39, G, z, 39.5, G + SHED_H, z + 0.5, 'steel-column');
  for (const [x, z] of [
    [33, 60],
    [45, 60],
    [33, 88],
    [45, 88],
  ] as const) {
    box(b, x, G + 3, z, x + 1.5, G + 3.5, z + 0.5, 'light-panel');
  }
  for (const z of [65, 75, 85]) box(b, 28, G + 3, z, 28.5, G + 3.5, z + 1.5, 'light-panel');
}

/** O terreiro: o poço, o galinheiro, os fardos, a lenha e o poste de luz. */
function terreiro(b: MapBuilder): void {
  // Poço: o bocal de bloco (2 × 2 m, 1 m: o zumbi sobe nele), tampado, sem esteio nem telhadinho (seriam degraus).
  box(b, 61, G, 58, 63, G + 1, 60, 'cinder-block');
  // Galinheiro de tábua com telhado de lona.
  box(b, 66, G, 56, 71, G + 2.5, 59, 'plank');
  box(b, 65.5, G + 2.5, 55.5, 71.5, G + 3, 59.5, 'canvas');
  // O fardo grande (2 m) atrás da porta da casa (ninguém vê do celeiro à sala).
  box(b, 52, G, 65, 58, G + 2, 67.5, 'hay-bale');
  // Fardos (2 m) logo dentro da janela de oeste e a pilha de lenha no canto sudeste (2 m), a 3 m das paliçadas.
  box(b, 53.5, G, 55.5, 56.5, G + 2, 60, 'hay-bale');
  box(b, 69, G, 67, 73, G + 2, 71, LOG);
  // Poste de luz de tora e as lâmpadas da paliçada e da fachada do celeiro.
  box(b, 65.5, G, 70.5, 66, G + 4, 71, LOG);
  lamp(b, 65.5, G + 4, 70.5);
  lamp(b, 62.5, G + 4, 52);
  lamp(b, 50, G + 2.5, 54);
  lamp(b, 76, G + 2.5, 68);
}

/** O celeiro: o jirau com o corrimão e a escada, os fardos, as baias, a selaria e as lâmpadas. */
function celeiro(b: MapBuilder): void {
  // O jirau: piso de tábua (0,5 m) apoiado em esteios de tora na beira.
  box(b, 44.5, LOFT_Y - 0.5, 28.5, 76, LOFT_Y, LOFT_Z1, 'plank');
  for (const x of [52, 60, 68]) box(b, x, G, LOFT_Z1 - 0.5, x + 0.5, LOFT_Y - 0.5, LOFT_Z1, LOG);
  b.fence(c(47), c(LOFT_Y), c(LOFT_Z1 - 0.5), c(76) - 1, c(LOFT_Z1 - 0.5), 'wood-rail-fence', 2);
  // A escada de tábua junto à parede oeste (2,5 m de largura: 2 nós da navegação): degraus de 0,5 m (o degrau
  // automático), subindo para o norte até encostar no jirau.
  for (let i = 0; i < 6; i++) {
    const z0 = LOFT_Z1 + 2.5 - i * 0.5;
    box(b, 44.5, G, z0, 47, G + (i + 1) * 0.5, z0 + 0.5, 'plank');
  }
  // Fardos debaixo do jirau (entre as janelas) e no vão do meio: a pilha alta na frente do portão (ninguém vê o
  // celeiro inteiro de fora) e a do meio; os baixos são cobertura.
  box(b, 52, G, 28.5, 55, G + 0.5, 30, 'hay-bale');
  box(b, 67.5, G, 28.5, 70, G + 0.5, 30, 'hay-bale');
  box(b, 48, G, 31, 51, LOFT_Y - 0.5, 34.5, 'hay-bale');
  box(b, 56, G, 31, 59, LOFT_Y - 0.5, 34.5, 'hay-bale');
  box(b, 61, G, 44, 66, G + 1, 46, 'hay-bale');
  box(b, 53, G, 47, 55, G + 1, 49, 'hay-bale');
  box(b, 72, G, 37, 74, G + 1, 40, 'hay-bale');
  // A ilha do meio: as baias (tábua de 2 m com a travessa branca e as portinholas em X) e, em cima delas, a parede da
  // tulha até o forro. Corta o celeiro (a volta por dentro) e não tem topo: ninguém pula do jirau para cima dela.
  box(b, 51, G, 39, 70, G + 2, 42, 'plank');
  box(b, 51, G + 2, 39, 70, G + BARN_H, 42, 'barn-wood');
  box(b, 51, G + 1.5, 39, 70, G + 2, 39.5, TRIM);
  box(b, 51, G + 1.5, 41.5, 70, G + 2, 42, TRIM);
  for (let x = 52; x < 69; x += 3) barnDoor(b, x, G, 41.5, 'x', 1, 1);
  // Em cima do jirau: fardos de 0,5 m na parede norte (o zumbi que sobe a escada golpeia quem pisar neles).
  box(b, 60, LOFT_Y, 28.5, 66, LOFT_Y + 0.5, 30, 'hay-bale');
  box(b, 70, LOFT_Y, 28.5, 76, LOFT_Y + 0.5, 30, 'hay-bale');
  // A selaria: o quartinho fechado de tábua no canto sudoeste, com a porta em X.
  box(b, 44.5, G, 45.5, 50.5, G + 3, 52, 'plank');
  box(b, 44.5, G + 3, 45.5, 50.5, G + 3.5, 52, 'plank-slab');
  barnDoor(b, 50, G, 47, 'z', 2, 2);
  // Lâmpadas penduradas (a 5 m) só no corredor do sul (longe do corrimão do jirau: seriam degrau), arandelas nas
  // paredes e na tulha, e as de debaixo do jirau.
  for (const x of [51, 59.5, 68]) lamp(b, x, G + 5, 46);
  for (const x of [54, 62, 68]) {
    lamp(b, x, G + 3, 39);
    lamp(b, x, G + 3, 41.5);
  }
  lamp(b, 44, G + 2.5, 42);
  lamp(b, 76, G + 2.5, 48);
  lamp(b, 52, G + 2.5, 52);
  lamp(b, 72, G + 2.5, 52);
  lamp(b, 57, LOFT_Y - 1, 31);
  lamp(b, 64, LOFT_Y - 1, 31);
  lamp(b, 48, LOFT_Y - 1, 31);
}

/** O pátio dos silos: os dois silos nos cantos, a ilha da volta no meio (casa de máquinas e graneleiro) e luz. */
function silos(b: MapBuilder): void {
  // Os dois silos nos cantos do norte, no pé de concreto (os marcos de longe).
  box(b, 77.5, 0.5, 30, 82.5, G, 35, 'concrete');
  box(b, 90, 0.5, 30, 95, G, 35, 'concrete');
  b.prop('silo', 80, G, 32.5, 0, 1, 1);
  b.prop('silo', 92.5, G, 32.5, Math.PI * 0.5, 1, 1);
  // O meio (a ilha da volta): a casa de máquinas de chapa, a moega (rente ao chão: não é degrau) e o graneleiro.
  box(b, 84, G, 33, 88, G + 3, 46, 'metal-panel');
  box(b, 84, G + 3, 33, 88, G + 3.5, 46, 'grate-slab');
  box(b, 90, G, 37, 93, G + 2, 42, 'hay-bale');
  box(b, 84, 0.5, 46, 88, G, 52, 'cinder-block');
  box(b, 84, G, 52, 88, G + 4, 60, 'metal-panel');
  box(b, 84, G + 4, 52, 88, G + 4.5, 60, 'grate-slab');
  // A pilha de fardos na frente da porta do terreiro e as duas da raia leste, desencontradas (cortam as retas de
  // ponta a ponta do pátio sem fechar a volta), todas a 3 m ou mais das paliçadas e sem degrau por perto.
  box(b, 79.5, G, 58, 82.5, G + 2, 64.5, 'hay-bale');
  box(b, 88, G, 49.5, 93, G + 2, 52.5, 'hay-bale');
  box(b, 90.5, G, 54, 93, G + 2, 57, 'hay-bale');
  box(b, 79, G, 44, 80.5, G + 0.5, 47, 'crate');
  lamp(b, 76, G + 4, 38);
  lamp(b, 96, G + 2.5, 44);
  lamp(b, 96, G + 2.5, 58);
  lamp(b, 86, G + 2.5, 70);
  lamp(b, 90, G + 2.5, 28);
  b.prop('floodlight', 78, G, 68, Math.PI * 0.8, 1, 1);
}

/** Cerca viva de 2,5 m (divisa dos campos; deixa a bala passar e tapa a visão). */
function hedge(b: MapBuilder, x0: number, z0: number, x1: number, z1: number): void {
  box(b, x0, G, z0, x1, G + 2.5, z1, 'leaves');
}

/** Fardos de feno empilhados (bloco de cobertura alta nos campos). */
function hayStack(b: MapBuilder, x: number, z: number, w: number, d: number, h = 2): void {
  box(b, x, G, z, x + w, G + h, z + d, 'hay-bale');
}

/** Milho em fileiras (1 m de terra arada, 1 m de pé de milho de `h` m) em [x0, x1) × [z0, z1), ao longo de X. */
function corn(b: MapBuilder, x0: number, z0: number, x1: number, z1: number, h: number): void {
  box(b, x0, 0.5, z0, x1, G, z1, 'farmland');
  for (let z = z0; z + 0.5 <= z1; z += 1.5) box(b, x0, G, z, x1, G + h, z + 0.5, 'crops');
}

/** Árvore de bloco: tronco de tora e copa de folhas (a copa começa a 2,5 m: dá para passar debaixo). */
function tree(b: MapBuilder, x: number, z: number, top = 5): void {
  box(b, x, G, z, x + 0.5, G + top - 1, z + 0.5, LOG);
  box(b, x - 1, G + 2.5, z - 1, x + 1.5, G + top, z + 1.5, 'leaves');
}

/**
 * Os campos de fora, divididos por cercas vivas que vão da parede do conjunto até a borda com UMA passagem cada,
 * alternando o lado (junto da parede, junto da borda): uma reta atravessa no máximo uma passagem de frente, e as
 * pilhas de feno no meio dos campos cortam as diagonais. Os zumbis andam pelas passagens.
 */
function fields(b: MapBuilder): void {
  // NOROESTE (x 10..44, z 10..40): o cata-vento (torre de treliça, cata-vento de tábua) e a caixa d'água.
  hedge(b, 14, 40, 44, 41);
  box(b, 24, G, 22, 25, G + 9, 23, 'crane-lattice');
  box(b, 24, G + 9, 22, 25.5, G + 10.5, 23, 'plank');
  box(b, 25.5, G + 7.5, 22.5, 26, G + 12.5, 23, 'plank');
  box(b, 25.5, G + 9.5, 20, 26, G + 10, 25.5, 'plank');
  box(b, 22, G + 9.5, 22.5, 24, G + 10.5, 23, 'plank');
  b.prop('water-tank', 28, G, 19, 0, 1, 1);
  hayStack(b, 34, 31, 3, 3);
  hayStack(b, 16, 30, 3, 2);
  hayStack(b, 26, 28, 3, 7);
  hayStack(b, 30, 14, 3, 6);
  hayStack(b, 38, 24, 3, 4);
  // NORTE (z 10..28): o milharal (tapa a visão dos bots), o espantalho e as pilhas de feno.
  hedge(b, 44, MIN_Z, 45, 24);
  hedge(b, 61, 14, 62, 28);
  hedge(b, 92, MIN_Z, 93, 24);
  corn(b, 46, 12, 60, 22, 2);
  corn(b, 63, 12, 91, 22, 2);
  box(b, 74, G, 17, 74.5, G + 2.5, 17.5, LOG);
  box(b, 73, G + 1.5, 17, 75.5, G + 2, 17.5, LOG);
  box(b, 74, G + 2.5, 17, 74.5, G + 3, 17.5, 'hay-bale');
  hayStack(b, 50, 22, 3, 5);
  hayStack(b, 79, 23.5, 3, 2);
  hayStack(b, 68, 13, 3, 4.5);
  hayStack(b, 86, 12, 3, 2);
  // NORDESTE e LESTE (x 93..110): o pasto, com as cercas vivas e os fardos.
  hayStack(b, 100, 20, 3, 2);
  hayStack(b, 104, 28, 3, 3);
  hedge(b, 96.5, 40, 106, 41);
  hedge(b, 100, 58, MAX_X, 59);
  hayStack(b, 103, 48, 2, 3);
  hayStack(b, 102, 70, 5.5, 2);
  hayStack(b, 104, 96, 6, 3);
  // SUDESTE: a horta (milho baixo) e o paiol de tábua; a cerca viva que fecha a horta do campo de baixo.
  corn(b, 78, 76, 84, 86, 1);
  // O trator e os rolos de feno ficam nos campos (só paisagem: dentro, o bobo subiria neles e o zumbi não).
  b.prop('tractor', 85.5, G, 84, 0, 1, 1);
  b.prop('hay-roll', 101, G, 78, 0.6, 1, 1);
  b.prop('hay-roll', 33, G, 100, 1.3, 1, 1);
  box(b, 88, G, 75, 92, G + 3, 79, 'plank');
  box(b, 87.5, G + 3, 74.5, 92.5, G + 3.5, 79.5, 'plank-slab');
  hedge(b, 75, 88, 106, 89);
  hayStack(b, 96, 80, 3, 2);
  hayStack(b, 91.5, 70.5, 3, 2.5);
  hayStack(b, 85, 72, 3, 3);
  hayStack(b, 88, 98, 3, 3);
  tree(b, 100, 102);
  tree(b, 80, 104);
  // SUL: a frente da fazenda (a estrada, a caixa de correio, a carroça de feno) entre as cercas vivas.
  hedge(b, 74, 80, 75, MAX_Z);
  hedge(b, 40, 88.5, 41, 106);
  box(b, 62, G, 105, 62.5, G + 1.5, 105.5, LOG);
  box(b, 61.5, G + 1.5, 105, 63, G + 2, 105.5, 'metal-panel');
  box(b, 65, G, 97, 68, G + 1, 102, 'plank');
  box(b, 65, G + 1, 97, 68, G + 2, 102, 'hay-bale');
  hayStack(b, 47, 99, 3, 2);
  hayStack(b, 43, 104, 3, 6);
  tree(b, 52, 104);
  tree(b, 70, 108);
  // SUDOESTE e OESTE: o pomar, o açude e as cercas vivas.
  hedge(b, 14, 86, 28, 87);
  hedge(b, MIN_X, 64, 24, 65);
  hayStack(b, 26, 96, 3, 2);
  for (const [x, z] of [
    [15, 92],
    [21, 100],
    [33, 104],
    [15, 47],
    [21, 51],
    [15, 56],
    [36, 47],
  ] as const) {
    tree(b, x, z);
  }
  hayStack(b, 28, 50, 3, 3);
  hayStack(b, MIN_X, 51, 6, 2);
  box(b, 13, 0.5, 72, 21, G, 82, 'sand');
  box(b, 14, 0, 73, 20, 0.5, 81, 'dirt');
  box(b, 14, 0.5, 73, 20, G, 81, 'water');
  hayStack(b, 19, 66.5, 5, 3.5);
  // Holofotes de pé nos campos (a lua não basta para ver o zumbi chegando).
  b.prop('floodlight', 30, G, 26, Math.PI * 0.25, 1, 1);
  b.prop('floodlight', 98, G, 26, -Math.PI * 0.25, 1, 1);
  b.prop('floodlight', 30, G, 91, Math.PI * 0.75, 1, 1);
  b.prop('floodlight', 98, G, 91, -Math.PI * 0.75, 1, 1);
}

/** Fora da área: o milharal alto e as árvores (só paisagem, atrás da cerca viva). */
function border(b: MapBuilder): void {
  const rng = b.rng('borda');
  corn(b, 0, 0.5, SIZE, MIN_Z - 1.5, 2);
  for (let i = 0; i < 18; i++) {
    const side = i % 3;
    const t = rng.range(4, SIZE - 4);
    const d = rng.range(2, MIN_X - 3);
    const [x, z] = side === 0 ? [d, t] : side === 1 ? [SIZE - d, t] : [t, SIZE - d];
    if (z < MIN_Z + 2 && side !== 2) continue;
    b.prop('tree', x, G, z, rng.range(0, Math.PI * 2), 1, 1);
  }
  for (let x = 0.5; x < SIZE - 0.5; x += 0.5) {
    for (let z = 0.5; z < SIZE - 0.5; z += 0.5) {
      const out = x < MIN_X - 1 || x >= MAX_X + 1 || z < MIN_Z - 1 || z >= MAX_Z + 1;
      const roll = rng.next();
      if (out && z > MIN_Z && roll < 0.05) b.cross(c(x), c(G), c(z), 'tall-grass');
    }
  }
}

function spawns(b: MapBuilder): void {
  // Os bobos nascem na casa (o gerador do Fortress fica ao lado do ponto mais perto do meio deles: na sala).
  for (const [x, z] of [
    [53, 80],
    [57, 77],
    [57, 85],
    [63, 78],
  ] as const) {
    b.spawn({ x, y: G, z, yaw: yawTo(x, z, 59, 81), team: 0 });
  }
  // Os zumbis nascem nos campos do sul e do leste: o sorteio do ponto (`pickZombieSpawn`) não sabe quais áreas estão
  // abertas, então os pontos ficam onde a rota até as janelas da casa é curta (12 a 60 m, média ~30 m, como na Base);
  // o milharal e o pomar ficam só de passagem (revisão da fase 5: com os 17 de antes, a média era 70 m e a 1ª onda
  // demorava o dobro da Base).
  for (const [x, z] of [
    [55, 98],
    [64, 95],
    [71, 94],
    [45, 96],
    [35, 95],
    [80, 74],
    [92, 82],
    [97, 75],
    [104, 66],
    [101, 52],
  ] as const) {
    b.spawn({ x, y: G, z, yaw: yawTo(x, z, 62, 60), team: -1 });
  }
}

function cameras(b: MapBuilder): void {
  const camera = (name: string, x: number, y: number, z: number, tx: number, ty: number, tz: number): void =>
    b.camera({ name, x, y, z, yaw: yawTo(x, z, tx, tz), pitch: pitchTo(x, y, z, tx, ty, tz), fovYDeg: 0 });
  camera('print:farm', 100, 30, 112, 62, G, 58);
  camera('print:farm-casa', 66, G + 1.55, 86.5, 52, G + 1, 77);
  camera('print:farm-terreiro', 58, G + 1.55, 72, 66, G + 3, 52);
  camera('print:farm-silos', 77.5, G + 7, 69, 88, G + 2, 40);
  camera('print:farm-celeiro', 72, LOFT_Y + 1.55, 33, 54, G + 0.5, 47);
}

const farm: MapScript = {
  id: 'farm',
  build(b) {
    b.size(c(SIZE), 40, c(SIZE));
    b.meta({
      nameKey: 'map.farm.name',
      modes: ['zombies'],
      players: { min: 1, ideal: 4, max: 4 },
      maxSightLineM: 50,
      botCaps: {},
    });
    b.playArea(MIN_X, MIN_Z, MAX_X, MAX_Z, G - 10);
    b.sun(0.3, 0.6, 0.5, 'night');
    ground(b);
    border(b);
    walls(b);
    roofs(b);
    casa(b);
    galpao(b);
    terreiro(b);
    celeiro(b);
    silos(b);
    fields(b);
    objects(b);
    spawns(b);
    cameras(b);
  },
};

export default farm;
