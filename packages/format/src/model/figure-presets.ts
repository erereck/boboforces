/**
 * Aparências prontas do boneco (decisão #56; PLANO do porte §B15 e §C3; estudo de pintura §7). Os ids
 * `skin:recruit|mechanic|pilot|zombie` ficam (regra 20) e passam a apontar para `FigureLook`; os 8 visuais do teste
 * entram com ids descritivos (`content-ids.ts`). Mudar um look muda as skins de toda partida (e o golden): só com print.
 *
 * Os 8 visuais são os MESMOS dados de rosto e cabelo do teste aprovado (`local/futbobo-teste/cabecas/src/main.ts:30-61`,
 * sempre com `version: 2`), com as cores das listas do FutBobo resolvidas em RGB (o índice vai no comentário). A roupa
 * é a farda da decisão #58 (sai o uniforme de futebol): cada visual com um tecido e cores próprios, para a fila dos bots
 * não parecer um pelotão de clones. Cores militares, longe das 4 cores de time (nenhuma peça cai na trava de cor).
 */
import { FIGURE_FABRIC, normalizeFigureLook, type FigureLook, type FigureOutfit } from './figure-look.ts';

export type FigurePresetId =
  | 'recruit'
  | 'mechanic'
  | 'pilot'
  | 'zombie'
  | 'classico'
  | 'blackpower'
  | 'sardento'
  | 'dreads'
  | 'bandana'
  | 'moicano'
  | 'barbudo'
  | 'trancas'
  // M2 (fase 6d): as fantasias (#62), só para o Meu Bobo (os bots seguem com a farda).
  | 'astronaut'
  | 'pajamas'
  | 'cardboard'
  | 'diver'
  // M3 (fase 5b): os especiais do Bobo Zombies (arte-ux.md §2.8).
  | 'zombie-sprinter'
  | 'zombie-chonker'
  | 'zombie-spitter'
  | 'zombie-mega';

const F = FIGURE_FABRIC;
/** Sem a peça (colete ou luvas). */
const NONE = -1;
const BLACK_BOOTS = 0x1c1c1a;
const BROWN_BOOTS = 0x45332a;
const BLACK_GLOVES = 0x262622;

function outfit(
  fabric: number,
  jacket: number,
  pants: number,
  vest: number,
  boots: number,
  gloves: number,
): FigureOutfit {
  return { fabric, jacket, pants, vest, boots, gloves };
}

export const FIGURE_PRESETS: Readonly<Record<FigurePresetId, FigureLook>> = {
  // Recruta (§B15): pele FB 4, cabelo FB 2, Raspado, Sério, sobrancelha Reta, olhos FB 1, sem capacete (#56/#57).
  // Woodland, calça oliva, colete ranger, luvas e botas pretas.
  recruit: normalizeFigureLook({
    skinTone: 0xcc8965,
    hair: 0x473023,
    eyes: 0x35251d,
    hairStyle: 5,
    face: 0,
    brow: 1,
    beard: 0,
    outfit: outfit(F.woodland, 0x5d6b40, 0x4e5838, 0x434a31, BLACK_BOOTS, BLACK_GLOVES),
  }),
  // Mecânico: pele FB 6, cabelo FB 1, Arrepiado, bigode, Confiante, boné no laranja de hoje. Macacão liso cinza-oliva
  // manchado de graxa (jaqueta = calça), sem colete fora de time e de mão nua; botina marrom.
  mechanic: normalizeFigureLook({
    skinTone: 0x985d43,
    hair: 0x28201b,
    hairStyle: 24,
    face: 1,
    beard: 3,
    headwear: 4,
    accessory: 0xc4723f,
    outfit: outfit(F.grease, 0x6c6e58, 0x6c6e58, NONE, BROWN_BOOTS, NONE),
  }),
  // Piloto: pele FB 1, cabelo FB 13, Clássico, óculos esportivos com a armação marrom. Macacão de voo verde-sálvia
  // (jaqueta = calça), sem colete fora de time, luvas de couro no marrom da armação.
  pilot: normalizeFigureLook({
    skinTone: 0xedbf9d,
    hair: 0xcf6f38,
    hairStyle: 0,
    eyewear: 1,
    accessory: 0x4a2e2e,
    outfit: outfit(F.plain, 0x7f8c68, 0x7f8c68, NONE, BLACK_BOOTS, 0x4a2e2e),
  }),
  // Zumbi (§B11): pele verde, cabelo FB 1, Arrepiado, rosto em espiral. Woodland velho (o pintor desbota e rasga), sem
  // colete e de mão nua; bota marrom gasta.
  zombie: normalizeFigureLook({
    skinTone: 0x8fae74,
    hair: 0x28201b,
    hairStyle: 24,
    outfit: outfit(F.woodland, 0x6a6349, 0x4b4434, NONE, 0x3b2f2a, NONE),
    zombie: { kind: 'common', faceStyle: 0 },
  }),
  // 1: pele 2, cabelo 0, olhos 1, Clássico, Sério, sobrancelha Reta. Urbano cinza, colete preto.
  classico: normalizeFigureLook({
    skinTone: 0xe5aa84,
    hair: 0x12110f,
    eyes: 0x35251d,
    hairStyle: 0,
    face: 0,
    beard: 0,
    brow: 1,
    outfit: outfit(F.urban, 0x80848a, 0x5d6168, 0x2a2c30, BLACK_BOOTS, BLACK_GLOVES),
  }),
  // 2: pele 6, cabelo 0, olhos 0, Black power, Sorriso, barba por fazer, Intensa. Deserto, colete coiote.
  blackpower: normalizeFigureLook({
    skinTone: 0x985d43,
    hair: 0x12110f,
    eyes: 0x111816,
    hairStyle: 4,
    face: 2,
    beard: 7,
    brow: 2,
    outfit: outfit(F.desert, 0xc4ad82, 0xa48e68, 0x86704f, BROWN_BOOTS, 0xb09a72),
  }),
  // 3: pele 0, cabelo 5, olhos 2, Franja, Tranquilo, Suave, sardas. Liso verde-oliva, calça cáqui, colete oliva.
  sardento: normalizeFigureLook({
    skinTone: 0xf6d9c0,
    hair: 0xbd8654,
    eyes: 0x31505b,
    hairStyle: 1,
    face: 4,
    beard: 0,
    brow: 0,
    faceMark: 1,
    outfit: outfit(F.plain, 0x6b7149, 0x988c66, 0x50573a, BROWN_BOOTS, 0x5a5f3e),
  }),
  // 4: pele 4, cabelo 2, olhos 4, Dreads, Confiante, barba cheia, Grossa. Woodland com calça marrom, colete preto.
  dreads: normalizeFigureLook({
    skinTone: 0xcc8965,
    hair: 0x473023,
    eyes: 0x765139,
    hairStyle: 9,
    face: 1,
    beard: 2,
    brow: 4,
    outfit: outfit(F.woodland, 0x58673e, 0x5c5240, 0x26272a, BLACK_BOOTS, BLACK_GLOVES),
  }),
  // 5: pele 8, cabelo 0, olhos 1, Careca, Concentrado, cavanhaque, Intensa, bandana vermelha (acessório 2). Noturno,
  // tudo escuro (a bandana vermelha salta).
  bandana: normalizeFigureLook({
    skinTone: 0x4b3027,
    hair: 0x12110f,
    eyes: 0x35251d,
    hairStyle: 12,
    face: 3,
    beard: 1,
    brow: 2,
    headwear: 3,
    accessory: 0xd7263d,
    outfit: outfit(F.night, 0x323844, 0x272b33, 0x1f2125, BLACK_BOOTS, 0x1c1c1c),
  }),
  // 6: pele 3, cabelo 13, olhos 3, Moicano, Desconfiado, bigode, Com risco. Deserto claro, colete oliva, bota cáqui.
  moicano: normalizeFigureLook({
    skinTone: 0xd99b73,
    hair: 0xcf6f38,
    eyes: 0x49633c,
    hairStyle: 3,
    face: 10,
    beard: 3,
    brow: 3,
    outfit: outfit(F.desert, 0xcdb88f, 0xb7a27b, 0x5b6142, 0x6f5a40, 0x8b7352),
  }),
  // 7: pele 1, cabelo 7, olhos 5, Repartido, Sério, barba longa, Reta. Urbano claro, colete cinza-chumbo.
  barbudo: normalizeFigureLook({
    skinTone: 0xedbf9d,
    hair: 0xded8cc,
    eyes: 0x7c8f98,
    hairStyle: 25,
    face: 0,
    beard: 8,
    brow: 1,
    outfit: outfit(F.urban, 0x9d9f9b, 0x55595e, 0x46494e, BLACK_BOOTS, 0x3a3c40),
  }),
  // 8: pele 5, cabelo 1, olhos 0, Tranças, Sorrisão, Suave, faixa branca (acessório 0), um brinco. Jaqueta lisa areia,
  // calça oliva, colete coiote.
  trancas: normalizeFigureLook({
    skinTone: 0xbd7b58,
    hair: 0x28201b,
    eyes: 0x111816,
    hairStyle: 6,
    face: 9,
    beard: 0,
    brow: 0,
    headwear: 1,
    accessory: 0xf4f4f2,
    earrings: 1,
    outfit: outfit(F.plain, 0xa99470, 0x5a5e42, 0x7a6547, BROWN_BOOTS, BLACK_GLOVES),
  }),
  // M2 (fase 6d): as fantasias (#62). Sem acessório 3D por enquanto (o capacete de astronauta e o resto ficam para a
  // arte): a fantasia sai do tecido, das cores e do rosto.
  // Astronauta: traje branco com painéis, mochila de suporte cinza (o "colete"), luvas e botas brancas.
  astronaut: normalizeFigureLook({
    skinTone: 0xe5aa84,
    hair: 0x473023,
    eyes: 0x31505b,
    hairStyle: 5,
    face: 1,
    brow: 1,
    outfit: outfit(F.spacesuit, 0xe8e6df, 0xe8e6df, 0xa7abad, 0xd0d0cc, 0xf0f0ec),
  }),
  // Pijama: listrado azul-claro, cabelo de quem acabou de acordar, de mão nua e pantufa.
  pajamas: normalizeFigureLook({
    skinTone: 0xd99b73,
    hair: 0x69422a,
    eyes: 0x35251d,
    hairStyle: 24,
    face: 4,
    brow: 0,
    outfit: outfit(F.stripes, 0x8fb0d6, 0x8fb0d6, NONE, 0x5a6f8f, NONE),
  }),
  // Robô de papelão: caixas com fita, "pele" de lata, careca e o visor (os óculos esportivos).
  cardboard: normalizeFigureLook({
    skinTone: 0x8d918c,
    hair: 0x12110f,
    eyes: 0x111816,
    hairStyle: 12,
    face: 0,
    brow: 2,
    eyewear: 1,
    accessory: 0x151515,
    outfit: outfit(F.cardboard, 0xb08a5a, 0xa47f50, 0x9c7748, 0x6b6f6c, 0x8d918c),
  }),
  // Mergulhador: roupa de neoprene preta, a máscara e o cilindro escuro nas costas (o "colete").
  diver: normalizeFigureLook({
    skinTone: 0xbd7b58,
    hair: 0x28201b,
    eyes: 0x1f6a74,
    hairStyle: 5,
    face: 3,
    brow: 1,
    eyewear: 2,
    accessory: 0xffd23f,
    outfit: outfit(F.plain, 0x1c1c1a, 0x1c1c1a, 0x2f3640, 0x1c1c1a, 0x1c1c1a),
  }),
  // M3 (fase 5b): os especiais do Bobo Zombies (arte-ux.md §2.8). A mesma pele verde do zumbi comum; o pintor desbota e
  // rasga a roupa de todos, e cada um tem a roupa e o rosto do tipo (cores longe das 4 de time).
  // Sprinter: agasalho de corrida vinho, faixa clara na testa, cabelo raspado, olho caído e tênis claro.
  'zombie-sprinter': normalizeFigureLook({
    skinTone: 0x8fae74,
    hair: 0x28201b,
    hairStyle: 5,
    headwear: 1,
    accessory: 0xd9d4c4,
    outfit: outfit(F.plain, 0x6e2f3a, 0x5c2731, NONE, 0xc9c3b4, NONE),
    zombie: { kind: 'sprinter', faceStyle: 1 },
  }),
  // Chonker: macacão de obra telha com colete amarelo de segurança, boné amarelo (o capacete de obra), careca, língua
  // de fora; o pintor põe a barriga de gosma verde.
  'zombie-chonker': normalizeFigureLook({
    skinTone: 0x8fae74,
    hair: 0x28201b,
    hairStyle: 12,
    headwear: 4,
    accessory: 0xc9a23a,
    outfit: outfit(F.plain, 0x8a4f2a, 0x4f4335, 0xc9a43a, 0x3b2f2a, NONE),
    zombie: { kind: 'chonker', faceStyle: 2 },
  }),
  // Spitter: capa de chuva oliva, mullet, a boca em "uuuh" (de quem vai cuspir).
  'zombie-spitter': normalizeFigureLook({
    skinTone: 0x8fae74,
    hair: 0x3a2a1f,
    hairStyle: 13,
    outfit: outfit(F.plain, 0x6b7a35, 0x4b4434, NONE, 0x3b2f2a, NONE),
    zombie: { kind: 'spitter', faceStyle: 3 },
  }),
  // Mega Bobo: farda de oficial em camuflado noturno com colete marrom, boné escuro, boca costurada.
  'zombie-mega': normalizeFigureLook({
    skinTone: 0x8fae74,
    hair: 0x28201b,
    hairStyle: 12,
    headwear: 4,
    accessory: 0x2a2c33,
    outfit: outfit(F.night, 0x3a3f46, 0x2c3036, 0x5a3a2a, 0x1c1c1a, NONE),
    zombie: { kind: 'mega', faceStyle: 4 },
  }),
};

/**
 * Rotação dos bots (PLANO §B15): o perfil de plataforma escolhe as `figureBotLooks` primeiras (Switch e celular 3; PC
 * 6). Ordem fixa: muda as skins compostas no loading de toda partida.
 */
export const FIGURE_BOT_ROTATION: readonly FigurePresetId[] = [
  'recruit',
  'mechanic',
  'pilot',
  'classico',
  'blackpower',
  'dreads',
  'sardento',
  'bandana',
  'moicano',
  'barbudo',
  'trancas',
];
