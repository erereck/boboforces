// Roteiro dos prints automáticos e a folha de contato local. Só dados e texto (sem navegador): o `scripts/prints.ts`
// executa o roteiro no Edge.
//
// Três rodadas no mesmo roteiro (`--so escolhas`, `--so rodada3` ou `--so rodada4`; sem `--so`, tudo):
// - ESCOLHAS (M1; PLANO_M1 critério 1; GDD §5.8; arte-ux.md §5.2): hora, densidade, leitura, fontes, altura, título e
//   setores. Saíram as doses (#52 fechou a pergunta), o mip (#50), as variações com contorno (#50) e com a skin de
//   densidade dobrada (#51); os números dos conjuntos ficam os da rodada 0.0.1 (3 e 5 aposentados) para os nomes dos
//   arquivos continuarem comparáveis entre rodadas.
// - RODADA 3 (porte do boneco do FutBobo, decisão #56; PLANO do porte §D passo 6, §B16 e §G): régua, fila dos 12
//   looks, close, vitrine armada, zumbi, mira, sequência com dt fixo, andar de lado e de ré e a leitura de 5 a 50 m,
//   mais as 16 perguntas da rodada com o padrão marcado (o Erick responde na folha de contato). Os prints que só
//   existem numa CÓPIA descartável (H5, PF, P1, cabelo "aceitar" e "achatar", molas cheias, capacete em casca, grão,
//   antebraço +1 px, visuais nos bots) ficam marcados com `copy`: a árvore principal só deixa o lugar na folha e a
//   cópia roda `--copia <variante>` (passo 6).
// - RODADA 4 (roupa militar, decisão #58): a tropa (fila de frente e de costas nos 2 times e sem time), a farda a 1 m de
//   frente e de costas, a leitura de 5 a 50 m, a vitrine e o zumbi, mais as 4 perguntas R1–R4 com o padrão marcado.
//
// Dois tipos de página:
// - CENA: o bench parado numa vista (`?bench&…`), comandado pelo gancho `GameDebugApi`. Cada print traz TODAS as
//   chaves (câmera, hora, dose, cinza, mip, HUD, folha das fontes e, na rodada 3, os manequins e o clipe): a ordem dos
//   prints não muda o resultado e um print falho não contamina o seguinte. Viewmodel escondido e cena congelada em
//   todos; HUD só onde o print pede.
// - TÍTULO: a tela de título de verdade (web) ou a prévia do título do Switch (`?titulo=switch`: a casca web finge a
//   plataforma do Switch e passa os 9 itens de teste dele; `apps/web/src/title-preview.ts`). Sem gancho: a tela é a do
//   jogo, sem chaves.
//
// PEDIDOS À INTEGRAÇÃO (passo 5), sem os quais os prints da rodada 3 ficam `pendente`:
// - `FigurePrintHook` (abaixo) no `GameDebugApi`: `setMannequins` (aparência, time, pose, arma, mira, expressão e
//   giro dos manequins nomeados) e `setFigureClip` (um manequim posado pelo motor de animação com dt FIXO);
// - as câmeras opcionais `print:linha-*`, `print:close-1m` e `print:altura-45` (a régua a 45°, no contrato desde o
//   passo 5);
// - a chave do bench que pede as skins da fila no loading (`PRINTS_LOADING_PARAM`, hoje `null`).

/** Valores do contrato (`TimeOfDay`, `PropDoseView`, `RenderDebug.mipFilter`); o teste confere contra o format. */
export type PrintTimeOfDay = 'day' | 'dusk' | 'night';
export type PrintPropDose = 'blocks' | 'proposal' | 'double';
export type PrintMipFilter = 'off' | 'nearest' | 'linear';

// --- Rodada 3: manequins, clipes e o gancho pedido ---

/** Pose do manequim (contrato `MapMannequin.pose` do format): `aim` = em pé mirando (ADS). */
export type MannequinPose = 'stand' | 'crouch' | 'aim' | 'slide';

/**
 * Aparência: id de conteúdo `skin:*` (regra 20; as 4 prontas e os 8 visuais do FutBobo) ou `padrao` =
 * `FIGURE_LOOK_DEFAULT` (o look que o bot excedente recebe no colete do próprio time, PLANO do porte §B15).
 */
export type PrintLook = `skin:${string}` | 'padrao';

/** Ajuste de um manequim nomeado num print (campo omitido = o do mapa). */
export interface MannequinOverride {
  /** Manequim nomeado do mapa (`altura:em-pe`, `linha:3`, `close:1`, `densidade`…). */
  readonly name: string;
  readonly look?: PrintLook;
  /** −1 sem time (farda do look); 0 = time A; 1 = time B. */
  readonly team?: number;
  readonly pose?: MannequinPose;
  /** Modelo de arma na mão sem prefixo (`rifle`, `pistol`, `sniper`; `''` sem arma), como `MapMannequin.weapon`. */
  readonly weapon?: string;
  /** Mira em rad (+ = para cima), na faixa da tabela de jogo (`FIGURE_PITCH_SAMPLES`, −1,2..1,2). */
  readonly pitch?: number;
  /**
   * 0..7 (`FACE_EXPRESSIONS`: neutro, mirando, bravo, assustado, dor, comemorando, dormindo, morto). Substitui a que a
   * câmera `print:linha-expressoes` põe na fila.
   */
  readonly expression?: number;
  /**
   * Giro em graus SOMADO ao yaw do mapa e ao giro que a câmera da fila já dá (`print:linha-3-4` a 3/4,
   * `print:linha-costas` de costas, como no teste "cabeça"): 180 com a `print:close-1m` = de costas para a câmera.
   */
  readonly turnDeg?: number;
  /** Corte do FutBobo por cima do look (0..33, `HAIR_STYLE_NAMES`: 4 Black power, 31 Afro gigante). */
  readonly hairStyle?: number;
  /** Chapéu pintado por cima do look (0..4, `HEADWEAR_NAMES`: 4 Boné). */
  readonly headwear?: number;
}

/**
 * Clipes do motor de animação para os quadros com dt fixo (PLANO do porte §D passo 6, E.2 e G13). O texto é o roteiro
 * de entrada que o game alimenta; o quadro 0 é o evento, e o preparo antes dele roda com o mesmo dt.
 */
export const FIGURE_CLIPS = {
  start: 'arrancar: parado e armado; no quadro 0 corre para a frente a 6,8 m/s',
  stop: 'parar: 1 s correndo a 6,8 m/s; no quadro 0 solta o direcional (freia pela aceleração da sim)',
  strafe: 'ADAD: andando de lado, troca de lado a cada 0,25 s (15 quadros a 60 Hz) desde o quadro 0',
  jump: 'pular: parado; pulo no quadro 0',
  land: 'pousar: caindo de 0,8 m; toca o chão no quadro 0',
  hit: 'levar dano: parado e armado; leva um tiro de frente no quadro 0',
  walk: 'andar para a frente: anda desde o quadro 0 (passada em regime depois de 0,5 s)',
  sidestep: 'andar de lado: anda de lado desde o quadro 0 (o passinho do goleiro)',
  backpedal: 'andar de ré: anda de ré desde o quadro 0 (a passada invertida)',
} as const;
export type FigureClipId = keyof typeof FIGURE_CLIPS;

/** Um manequim posado pelo clipe, no quadro `frame` contado a `dtS` fixo desde o evento. */
export interface FigureClipFrame {
  readonly mannequin: string;
  readonly clip: FigureClipId;
  readonly frame: number;
  readonly dtS: number;
}

/** dt dos quadros congelados (60 Hz, o passo da sim). */
export const CLIP_DT_S = 1 / 60;

/**
 * PEDIDO DE CONTRATO à integração (passo 5): membros novos do `GameDebugApi` (`packages/game/src/bench/types.ts`) para
 * a rodada 3. Até o game expor, o `scripts/prints.ts` marca os prints que precisam deles como `pendente`.
 */
export interface FigurePrintHook {
  /**
   * Troca aparência, time, pose, arma, mira, expressão e giro dos manequins nomeados. A lista SUBSTITUI a anterior
   * (quem não está nela volta ao mapa; `[]` volta todos). Os da fila e do close continuam só com a câmera deles. As
   * skins de looks fora da cena são compostas sob demanda (só na web). `false` se um nome ou look não existe (aí nada
   * muda).
   */
  setMannequins(overrides: readonly MannequinOverride[]): boolean;
  /**
   * Posa um manequim pelo motor de animação: zera o estado do boneco, alimenta o clipe por `frame + preparo` quadros
   * de `dtS` (fixo, sem o relógio) e o deixa parado nesse quadro com a cena congelada. O manequim não sai do lugar:
   * velocidade, postura e eventos entram só no rig (o quadro da câmera continua valendo). `null` desliga. `false` se o
   * manequim ou o clipe não existe.
   */
  setFigureClip(clip: FigureClipFrame | null): boolean;
}
export const FIGURE_HOOK_MEMBERS = [
  'setMannequins',
  'setFigureClip',
] as const satisfies readonly (keyof FigurePrintHook)[];

/**
 * Câmeras que a rodada 3 usa e que NÃO estão no contrato do mapa (pedido à F6/integração). Vazia desde o passo 5: a
 * régua a 45° (`print:altura-45`) entrou nas opcionais do contrato (`OPTIONAL_PRINT_CAMERAS`) e no Construto.
 */
export const REQUESTED_CAMERAS: readonly string[] = [];

/**
 * Chave do bench que diz ao loading "isto é uma rodada de prints" (compor as skins da fila e do close, §B16). `null`
 * até o `BENCH_PARAMS` do game ter a chave; a integração troca pelo nome (o teste confere que existe no contrato).
 */
export const PRINTS_LOADING_PARAM: string | null = 'prints';

// --- Chaves, conjuntos e prints ---

/** Chaves aplicadas pelo gancho `GameDebugApi` antes de cada print de cena. */
export interface PrintSettings {
  /**
   * Câmera nomeada do mapa, ou `null` = a vista do jogador do bench (pilotado por bot e congelado com a cena). O HUD só
   * aparece na vista do jogador: com câmera nomeada o jogo esconde o HUD da vista 0.
   */
  readonly camera: string | null;
  readonly timeOfDay: PrintTimeOfDay;
  /** Sempre a dose do jogo (`PLAYABLE_PROP_DOSE_VIEW`, decisão #52): o print mostra as props que colidem. */
  readonly propDose: PrintPropDose;
  readonly grayscale: boolean;
  /** Sempre o padrão do jogo (`NEAREST_MIPMAP_LINEAR`, decisão #50). */
  readonly mipFilter: PrintMipFilter;
  readonly hud: boolean;
  /** Folha das fontes em uso em tela cheia (`showFontSpecimen`, decisão #54). */
  readonly fontSpecimen: boolean;
  /** Rodada 3: manequins ajustados (`setMannequins`); vazio = o mapa como está. */
  readonly mannequins: readonly MannequinOverride[];
  /** Rodada 3: o manequim posado com dt fixo (`setFigureClip`); `null` = sem clipe. */
  readonly clip: FigureClipFrame | null;
}

export type PrintSetId =
  | 'hora'
  | 'densidade'
  | 'leitura'
  | 'fontes'
  | 'altura'
  | 'titulo'
  | 'setores'
  | 'regua'
  | 'fila'
  | 'close'
  | 'vitrine'
  | 'zumbi'
  | 'mira'
  | 'sequencia'
  | 'andar'
  | 'bots'
  | 'tropa'
  | 'farda'
  | 'patio'
  | 'infectado';

/** Rodada: as escolhas do M1 (#50–#54), a rodada 3 do porte do boneco (#56) ou a rodada 4 da roupa militar (#58). */
export type PrintRound = 'escolhas' | 'rodada3' | 'rodada4';
export const PRINT_ROUNDS: readonly PrintRound[] = ['escolhas', 'rodada3', 'rodada4'];

export interface PrintSetInfo {
  readonly id: PrintSetId;
  readonly number: number;
  readonly title: string;
  /** O que o Erick decide (ou confere) olhando este conjunto. */
  readonly question: string;
  /** Rodadas que incluem o conjunto (`--so rodada3`). */
  readonly rounds: readonly PrintRound[];
}

export const PRINT_SETS: readonly PrintSetInfo[] = [
  {
    id: 'hora',
    number: 1,
    title: 'Dia, Entardecer e Noite (regressão)',
    question:
      'As três luzes aprovadas na decisão #50 continuam iguais, com as props do dobro (#52) e os bobos novos (#56)?',
    rounds: ['escolhas'],
  },
  {
    id: 'densidade',
    number: 2,
    title: 'Densidade de textura (bobo e parede a 1 m e 3 m)',
    question:
      'A skin do boneco (36,6 t/m na cabeça e no tronco; membros em cor de paleta) lê bem ao lado da parede de 32 px/m' +
      ' (decisão #51), a 1 m e a 3 m?',
    rounds: ['escolhas'],
  },
  {
    id: 'leitura',
    number: 4,
    title: 'Leitura de bobos a 5, 15, 30 e 50 m (640×360)',
    question:
      'Sem contorno (decisão #50): dá para ler aliado e inimigo? O contraste passa no cinza? O de 50 m na rota do atlas' +
      ' (plano B, com menos níveis de mip) cintila? (Visão de 90 m: no 3–4P a fog vai de 22,5 a 50 m e o par de 50 m' +
      ' fica no fim dela.) Na rodada 4 (a camisa da G9 saiu, #58): o colete, a braçadeira, as luvas e as joelheiras' +
      ' do time leem de 30 a 50 m? (R2, R3)',
    rounds: ['escolhas', 'rodada3', 'rodada4'],
  },
  {
    id: 'fontes',
    number: 6,
    title: 'Fontes em uso: Russo One e Saira Condensed (decisão #54)',
    question:
      'A folha das fontes como saíram do atlas e o HUD na partida: algum glifo, acento ou algarismo ficou ruim nos' +
      ' tamanhos do jogo?',
    rounds: ['escolhas'],
  },
  {
    id: 'altura',
    number: 7,
    title: 'Altura dos bobos na régua de métricas (decisão #53)',
    question:
      'Ao lado da porta de 2,0 m, do muro de 1,5 m e da cobertura de 1,0 m, o bobo em pé e o agachado atrás da' +
      ' cobertura parecem certos?',
    rounds: ['escolhas'],
  },
  {
    id: 'titulo',
    number: 8,
    title: 'Título na web e no Switch',
    question:
      'O logo novo, os botões e os testes cabem sem sobrepor na web (1280×720 e 640×360) e no Switch, com os 9 itens' +
      ' de teste em grade?',
    rounds: ['escolhas'],
  },
  {
    id: 'setores',
    number: 9,
    title: 'Números de setor no chão',
    question:
      'Na altura do olho, o 9 visto do sul e o 6 visto do norte (girado) se distinguem? O sublinhado do 6 e do 9 marca' +
      ' o lado de baixo do número. O 4 e o 5 lado a lado se leem?',
    rounds: ['escolhas'],
  },
  {
    id: 'regua',
    number: 10,
    title: 'Régua do boneco: em pé, agachado P4f e deslizando, armados (1,75 m)',
    question:
      'Ao lado da porta de 2,0 m, do muro de 1,5 m e da cobertura de 1,0 m, de perfil e a 45°: a altura, o agachado P4f' +
      ' (topo 0,94 m), o deslize "carrinho" (topo 0,93 m) e o recorte do cabelo no teto de 0,99 m agachado e 1,99 m em' +
      ' pé parecem certos? (G4, G5, G12)',
    rounds: ['rodada3'],
  },
  {
    id: 'fila',
    number: 11,
    title: 'Fila dos 12 looks nos dois times: frente, 3/4, costas e expressões',
    question:
      'Os 12 looks (as 11 prontas da rotação dos bots e o padrão do time) ficam parecidos com o FutBobo e leem bem no' +
      ' kit do time A e do time B? As 8 expressões aparecem? (G2, G9)',
    rounds: ['rodada3'],
  },
  {
    id: 'close',
    number: 12,
    title: 'Close a 1 m (frente e costas) e a 3 m',
    question:
      'A 1 m, de frente e de costas: a camisa lisa na cor do time, o número no peito e o escudo? A 1 m e a 3 m, ao lado' +
      ' da parede de 32 px/m (#51), a skin pintada lê bem? (G9, G10)',
    rounds: ['rodada3'],
  },
  {
    id: 'vitrine',
    number: 13,
    title: 'Vitrine armada (fuzil, pistola, sniper, coletes de time e o zumbi)',
    question: 'A vitrine com as armas na mão e o zumbi do FutBobo, sem capacete: fica assim? (G1, G11)',
    rounds: ['rodada3'],
  },
  {
    id: 'zumbi',
    number: 14,
    title: 'Zumbi do FutBobo: de frente e o rosto a 1 m',
    question: 'O zumbi esverdeado e curvado, com o rosto pintado na skin (espiral, língua), fica? (G11)',
    rounds: ['rodada3'],
  },
  {
    id: 'mira',
    number: 15,
    title: 'Cabeça presa ao olho: mirando para cima e para baixo; agachado atrás da cobertura; ADS',
    question:
      'O tronco não inclina com a mira; a cabeça gira até 0,6 rad em pé (0,1 agachada) e desliza até 1,5 px. Agachado,' +
      ' os braços param em +0,6 rad e o cano pode aparecer acima da cobertura. Fica assim? E o ADS de 3ª pessoa? (G7,' +
      ' G14)',
    rounds: ['rodada3'],
  },
  {
    id: 'sequencia',
    number: 16,
    title: 'Sequência de 6 quadros com dt fixo: arrancar, parar, ADAD, pular, pousar e levar dano',
    question:
      'O balanço do FutBobo dentro do envelope (a cabeça anda no máximo 1 px em regime e 2 px no pico) ainda tem graça?' +
      ' (G6)',
    rounds: ['rodada3'],
  },
  {
    id: 'andar',
    number: 17,
    title: 'Andar para a frente, de lado e de ré (quadros congelados)',
    question: 'O passinho do goleiro no andar de lado e a passada invertida na ré ficam? (G13)',
    rounds: ['rodada3'],
  },
  {
    id: 'bots',
    number: 18,
    title: 'Visuais dos bots numa partida (só na cópia descartável)',
    question:
      'Switch com as 3 prontas por time (10 skins); PC com 3 prontas + 3 visuais do FutBobo (19). Cada visual a mais' +
      ' soma 3 skins (~50 ms de loading no Eden). Assim? (G8)',
    rounds: ['rodada3'],
  },
  {
    id: 'tropa',
    number: 19,
    title: 'Tropa com a farda: fila de frente e de costas nos dois times e sem time',
    question:
      'Os 12 looks de farda (#58) parecem soldados de jogo de tiro blocado com o boneco do FutBobo? Colete, braçadeira,' +
      ' luvas e joelheiras do time; sem time, o tecido e o colete de cada look (R1, R2, R3, R4)',
    rounds: ['rodada4'],
  },
  {
    id: 'farda',
    number: 20,
    title: 'Farda a 1 m: frente e costas nos dois times, e sem time',
    question:
      'De perto: a jaqueta, a gola, o colete com os porta-carregadores e o painel com o ícone ▲ ● ■ ◆, o cinto, as' +
      ' luvas e a braçadeira; sem time, o camuflado (R1, R2, R3, R4)',
    rounds: ['rodada4'],
  },
  {
    id: 'patio',
    number: 21,
    title: 'Vitrine armada com a farda (coletes de time e o zumbi)',
    question: 'A vitrine do mapa com as armas na mão e a roupa militar: fica assim? (R1)',
    rounds: ['rodada4'],
  },
  {
    id: 'infectado',
    number: 22,
    title: 'Zumbi com a farda desbotada e rasgada: de frente e o rosto a 1 m',
    question: 'O zumbi de farda velha (desbotada, rasgada, com remendos e curativos coloridos) fica? (R1)',
    rounds: ['rodada4'],
  },
];

/** De onde vem o título: a tela da web ou a prévia do Switch (`?titulo=switch`). */
export type TitleShell = 'web' | 'switch';

/** Variantes da cópia descartável (`%TEMP%\bf-<marca>`, passo 6): a árvore principal não as gera. */
export type CopyVariantId =
  | 'h5'
  | 'pf'
  | 'p1'
  | 'cabelo-aceitar'
  | 'cabelo-achatar'
  | 'molas-cheias'
  | 'capacete'
  | 'grao'
  | 'antebraco'
  | 'bots-visuais';

interface ShotBase {
  readonly set: PrintSetId;
  /** Nome do PNG, legível e agrupado pelo número do conjunto (`4-leitura-05m-cinza-640x360.png`). */
  readonly file: string;
  /** Identificador do print dentro do conjunto (o meio do nome do arquivo, sem a variante da cópia). */
  readonly slug: string;
  readonly caption: string;
  readonly width: number;
  readonly height: number;
  /** Variante da cópia descartável que gera este print; `null` = árvore principal. */
  readonly copy: CopyVariantId | null;
}

/**
 * Print da cena parada do bench. `atlas`: rota do atlas do plano B (`atlas=1`, fixa na criação do renderer). `bots` e
 * `profile` mudam a página (só a variante dos visuais dos bots usa: na árvore principal os prints têm 0 bots, §B16).
 */
export interface SceneShot extends ShotBase {
  readonly page: 'scene';
  readonly atlas: boolean;
  readonly bots: number;
  readonly profile: string | null;
  readonly settings: PrintSettings;
}

/** Print da tela de título (sem gancho e sem chaves). */
export interface TitleShot extends ShotBase {
  readonly page: 'title';
  readonly shell: TitleShell;
}

export type PrintShot = SceneShot | TitleShot;

export const SIZE_HD = { width: 1280, height: 720 } as const;
export const SIZE_SMALL = { width: 640, height: 360 } as const;
type Size = { readonly width: number; readonly height: number };

/** Chaves neutras: a cena como o jogo a mostra (dose do jogo, mip padrão), sem HUD, sem folha e com o mapa como está. */
export const PRINT_BASE: PrintSettings = {
  camera: 'print:dia',
  timeOfDay: 'day',
  propDose: 'double',
  grayscale: false,
  mipFilter: 'nearest',
  hud: false,
  fontSpecimen: false,
  mannequins: [],
  clip: null,
};

const TIMES: readonly { readonly value: PrintTimeOfDay; readonly slug: string; readonly label: string }[] = [
  { value: 'day', slug: 'dia', label: 'Dia' },
  { value: 'dusk', slug: 'entardecer', label: 'Entardecer' },
  { value: 'night', slug: 'noite', label: 'Noite' },
];
/** Distâncias do print de leitura (câmeras `print:leitura-<d>m`). */
export const READING_DISTANCES_M = [5, 15, 30, 50] as const;
/** O print de leitura que se repete na rota do atlas: o mais longe, onde faltam os níveis de mip. */
export const READING_ATLAS_DISTANCE_M = 50;

const sizeSlug = (s: Size): string => `${s.width}x${s.height}`;
const sizeLabel = (s: Size): string => `${s.width}×${s.height}`;

function setInfo(set: PrintSetId): PrintSetInfo {
  const info = PRINT_SETS.find((s) => s.id === set);
  if (!info) throw new Error(`conjunto de prints sem cadastro: ${set}`);
  return info;
}

function fileName(set: PrintSetId, slug: string, size: Size, copy: CopyVariantId | null = null): string {
  return `${setInfo(set).number}-${set}-${slug}${copy ? `-copia-${copy}` : ''}-${sizeSlug(size)}.png`;
}

interface SceneOptions {
  readonly atlas?: boolean;
  readonly bots?: number;
  readonly profile?: string;
}

function sceneShot(
  set: PrintSetId,
  slug: string,
  caption: string,
  size: Size,
  settings: Partial<PrintSettings>,
  options: SceneOptions = {},
): SceneShot {
  return {
    set,
    file: fileName(set, slug, size),
    slug,
    caption: `${caption} · ${sizeLabel(size)}`,
    width: size.width,
    height: size.height,
    copy: null,
    page: 'scene',
    atlas: options.atlas ?? false,
    bots: options.bots ?? 0,
    profile: options.profile ?? null,
    settings: { ...PRINT_BASE, ...settings },
  };
}

function titleShot(slug: string, caption: string, size: Size, shell: TitleShell): TitleShot {
  return {
    set: 'titulo',
    file: fileName('titulo', slug, size),
    slug,
    caption: `${caption} · ${sizeLabel(size)}`,
    width: size.width,
    height: size.height,
    copy: null,
    page: 'title',
    shell,
  };
}

/** Rodada das escolhas (#50–#54): 29 prints. */
function choiceShots(): PrintShot[] {
  const plan: PrintShot[] = [];
  for (const size of [SIZE_HD, SIZE_SMALL]) {
    for (const t of TIMES) plan.push(sceneShot('hora', t.slug, t.label, size, { timeOfDay: t.value }));
  }
  for (const m of [1, 3]) {
    plan.push(
      sceneShot('densidade', `${m}m`, `Bobo e parede a ${m} m`, SIZE_HD, {
        camera: `print:densidade-${m}m`,
      }),
    );
  }
  for (const m of READING_DISTANCES_M) {
    const camera = `print:leitura-${m}m`;
    const dist = String(m).padStart(2, '0');
    for (const grayscale of [false, true]) {
      const slug = `${dist}m-${grayscale ? 'cinza' : 'colorido'}`;
      const caption = `Leitura a ${m} m, ${grayscale ? 'em cinza' : 'colorido'}`;
      plan.push(sceneShot('leitura', slug, caption, SIZE_SMALL, { camera, grayscale }));
    }
  }
  plan.push(
    sceneShot(
      'leitura',
      `${READING_ATLAS_DISTANCE_M}m-colorido-atlas`,
      `Leitura a ${READING_ATLAS_DISTANCE_M} m, colorido, rota do atlas (plano B)`,
      SIZE_SMALL,
      { camera: `print:leitura-${READING_ATLAS_DISTANCE_M}m` },
      { atlas: true },
    ),
  );
  for (const size of [SIZE_HD, SIZE_SMALL]) {
    plan.push(sceneShot('fontes', 'em-uso', 'Folha das fontes em uso', size, { fontSpecimen: true }));
  }
  for (const size of [SIZE_HD, SIZE_SMALL]) {
    plan.push(sceneShot('fontes', 'hud', 'HUD visível, na vista do jogador', size, { camera: null, hud: true }));
  }
  for (const size of [SIZE_HD, SIZE_SMALL]) {
    plan.push(sceneShot('altura', 'regua', 'Régua de métricas, de perfil', size, { camera: 'print:altura' }));
  }
  for (const size of [SIZE_HD, SIZE_SMALL]) plan.push(titleShot('web', 'Título da web', size, 'web'));
  plan.push(titleShot('switch', 'Título do Switch com os 9 itens de teste', SIZE_HD, 'switch'));
  for (const [slug, caption] of [
    ['norte', 'Setor 9 visto do sul (olhando para o norte)'],
    ['sul', 'Setor 6 visto do norte (olhando para o sul, girado)'],
    ['4-5', 'Setores 4 e 5 lado a lado'],
  ] as const) {
    plan.push(sceneShot('setores', slug, caption, SIZE_HD, { camera: `print:setores-${slug}` }));
  }
  return plan;
}

// --- Rodada 3 ---

const NO_TEAM = -1;
const TEAM_A = 0;
const TEAM_B = 1;

/**
 * Os 12 looks da fila (PLANO do porte §B15 e §D passo 6): a rotação dos bots (`FIGURE_BOT_ROTATION`, na ordem) e o
 * padrão do time. O teste confere contra o format.
 */
export const FILA_LOOKS: readonly PrintLook[] = [
  'skin:recruit',
  'skin:mechanic',
  'skin:pilot',
  'skin:classico',
  'skin:blackpower',
  'skin:dreads',
  'skin:sardento',
  'skin:bandana',
  'skin:moicano',
  'skin:barbudo',
  'skin:trancas',
  'padrao',
];
/** Cabelo curto e cabelo alto da régua (passo 6: "cabelo curto × black power"). */
const LOOK_SHORT: PrintLook = 'skin:classico';
const LOOK_TALL: PrintLook = 'skin:blackpower';
const HAIR_AFRO_GIGANTE = 31;
const HEADWEAR_CAP = 4;
/** Nomes das expressões (`FACE_EXPRESSIONS`), em pt-BR para a legenda. */
export const EXPRESSION_LABELS = [
  'neutro',
  'mirando',
  'bravo',
  'assustado',
  'dor',
  'comemorando',
  'dormindo',
  'morto',
] as const;

/** Os três manequins da régua e a pose de cada um (o deslize é a pose `slide`, §B16). */
const REGUA: readonly (readonly [string, MannequinPose, string])[] = [
  ['altura:em-pe', 'stand', 'em pé'],
  ['altura:agachado', 'crouch', 'agachado P4f'],
  ['altura:deslizando', 'slide', 'deslizando'],
];
const REGUA_ANGLES: readonly (readonly [string, string, string])[] = [
  ['perfil', 'print:altura', 'de perfil'],
  ['45', 'print:altura-45', 'a 45°'],
];
const FILA_CAMERAS: readonly (readonly [string, string, string])[] = [
  ['frente', 'print:linha-frente', 'de frente'],
  ['3-4', 'print:linha-3-4', 'a 3/4'],
  ['costas', 'print:linha-costas', 'de costas'],
];
const LINE = (n: number): string => `linha:${n}`;
/** Manequim e câmera dos quadros com dt fixo: o 4º da fila, visto a 3/4 (os outros 7 ficam de referência parados). */
const CLIP_MANNEQUIN = 'linha:4';
const CLIP_CAMERA = 'print:linha-3-4';

function reguaOverrides(look: PrintLook, extra: Partial<MannequinOverride> = {}): MannequinOverride[] {
  return REGUA.map(([name, pose]) => ({ name, look, team: NO_TEAM, pose, weapon: 'rifle', pitch: 0, ...extra }));
}

/** O par do close a 1 m: `close:1` e `close:5` com os looks e os times dados, girados `turnDeg` (180 = de costas). */
function closePair(
  turnDeg: number,
  a: { readonly look: PrintLook; readonly team: number } = { look: LOOK_SHORT, team: TEAM_A },
  b: { readonly look: PrintLook; readonly team: number } = { look: LOOK_TALL, team: TEAM_B },
): MannequinOverride[] {
  return [
    { name: 'close:1', look: a.look, team: a.team, pose: 'stand', weapon: '', expression: 0, turnDeg },
    { name: 'close:5', look: b.look, team: b.team, pose: 'stand', weapon: '', expression: 0, turnDeg },
  ];
}

/** A fila dos 12 looks na página `page` (0..2): os 4 do time A em `linha:1..4` e os mesmos 4 do B em `linha:5..8`. */
function filaPage(page: number): MannequinOverride[] {
  const looks = FILA_LOOKS.slice(page * 4, page * 4 + 4);
  const mannequins: MannequinOverride[] = [];
  for (const [team, offset] of [
    [TEAM_A, 1],
    [TEAM_B, 5],
  ] as const) {
    looks.forEach((look, k) => {
      mannequins.push({ name: LINE(offset + k), look, team, pose: 'stand', weapon: '', pitch: 0, expression: 0 });
    });
  }
  return mannequins;
}

/** Rodada 3, árvore principal: régua, fila, close, vitrine, zumbi, mira, sequência e andar (40 prints em 1280×720). */
function round3Shots(): SceneShot[] {
  const plan: SceneShot[] = [];
  const hd = (set: PrintSetId, slug: string, caption: string, settings: Partial<PrintSettings>): void => {
    plan.push(sceneShot(set, slug, caption, SIZE_HD, settings));
  };

  // (10) Régua: em pé, P4f e deslizando, armados, com cabelo curto e black power, de perfil e a 45°; mais os cabelos
  // mais altos (afro gigante e boné) de perfil, para o recorte (G5).
  for (const [look, hair] of [
    [LOOK_SHORT, 'cabelo curto (Clássico)'],
    [LOOK_TALL, 'black power'],
  ] as const) {
    for (const [angle, camera, label] of REGUA_ANGLES) {
      const slug = `${look.slice('skin:'.length)}-${angle}`;
      hd('regua', slug, `Régua ${label}: em pé, P4f e deslizando, armados, ${hair}`, {
        camera,
        mannequins: reguaOverrides(look),
      });
    }
  }
  hd('regua', 'afro-perfil', 'Régua de perfil com o afro gigante (recorte em 0,99 m agachado e 1,99 m em pé)', {
    camera: 'print:altura',
    mannequins: reguaOverrides(LOOK_SHORT, { hairStyle: HAIR_AFRO_GIGANTE }),
  });
  hd('regua', 'bone-perfil', 'Régua de perfil com o boné (mecânico)', {
    camera: 'print:altura',
    mannequins: reguaOverrides('skin:mechanic', { headwear: HEADWEAR_CAP }),
  });
  // G5 ("black power, afro gigante e boné agachados: os 3 lado a lado"): os três manequins da régua agachados, um
  // cabelo em cada. A câmera de perfil fica na altura da cobertura: o horizonte é a linha de 1,0 m para os três.
  hd(
    'regua',
    'cabelos-agachados-perfil',
    'Régua de perfil com os 3 cabelos altos agachados lado a lado: black power, afro gigante e boné (teto de 0,99 m;' +
      ' o horizonte é o topo da cobertura de 1,0 m)',
    {
      camera: 'print:altura',
      mannequins: [
        { name: 'altura:em-pe', look: LOOK_TALL, team: NO_TEAM, pose: 'crouch', weapon: 'rifle', pitch: 0 },
        {
          name: 'altura:agachado',
          look: LOOK_SHORT,
          team: NO_TEAM,
          pose: 'crouch',
          weapon: 'rifle',
          pitch: 0,
          hairStyle: HAIR_AFRO_GIGANTE,
        },
        {
          name: 'altura:deslizando',
          look: 'skin:mechanic',
          team: NO_TEAM,
          pose: 'crouch',
          weapon: 'rifle',
          pitch: 0,
          headwear: HEADWEAR_CAP,
        },
      ],
    },
  );

  // (11) Fila: 12 looks em 3 páginas de 4, cada uma com o time A em `linha:1..4` e o B em `linha:5..8`; frente, 3/4 e
  // costas. Depois as 8 expressões, uma por manequim, em cada time.
  for (let page = 0; page < 3; page++) {
    const mannequins = filaPage(page);
    for (const [slug, camera, label] of FILA_CAMERAS) {
      const range = `${page * 4 + 1}–${page * 4 + 4}`;
      hd('fila', `${slug}-${page + 1}`, `Fila ${label}, looks ${range} (linha 1–4 time A, 5–8 time B)`, {
        camera,
        mannequins,
      });
    }
  }
  for (const [team, look, name] of [
    [TEAM_A, LOOK_SHORT, 'a'],
    [TEAM_B, LOOK_TALL, 'b'],
  ] as const) {
    const mannequins = EXPRESSION_LABELS.map((_, e): MannequinOverride => ({
      name: LINE(e + 1),
      look,
      team,
      pose: 'stand',
      weapon: '',
      expression: e,
    }));
    hd('fila', `expressoes-${name}`, `As 8 expressões (${EXPRESSION_LABELS.join(', ')}), time ${name.toUpperCase()}`, {
      camera: 'print:linha-expressoes',
      mannequins,
    });
  }

  // (12) Close: a 1 m de frente e de costas (time A e B lado a lado) e o manequim da densidade a 1 m e a 3 m.
  hd('close', 'frente-1m', 'Close a 1 m de frente: time A (Clássico) e time B (black power)', {
    camera: 'print:close-1m',
    mannequins: closePair(0),
  });
  hd('close', 'costas-1m', 'Close a 1 m de costas: número e escudo', {
    camera: 'print:close-1m',
    mannequins: closePair(180),
  });
  for (const m of [1, 3]) {
    hd('close', `densidade-${m}m`, `Boneco do time A e a parede a ${m} m`, {
      camera: `print:densidade-${m}m`,
      mannequins: [{ name: 'densidade', look: LOOK_SHORT, team: TEAM_A, pose: 'stand', weapon: '' }],
    });
  }

  // (13) Vitrine armada: a do mapa (fuzil, pistola, sniper, coletes A e B e o zumbi), ao dia.
  hd('vitrine', 'armada', 'Vitrine armada ao dia', { camera: 'print:dia' });

  // (14) Zumbi de frente na fila e o rosto a 1 m (ao lado de um bobo do time A).
  hd('zumbi', 'frente', 'Zumbi de frente na fila (linha 4), entre os bobos', {
    camera: 'print:linha-frente',
    mannequins: [{ name: LINE(4), look: 'skin:zombie', team: NO_TEAM, pose: 'stand', weapon: '' }],
  });
  hd('zumbi', 'rosto-1m', 'Rosto do zumbi a 1 m, ao lado do bobo do time A', {
    camera: 'print:close-1m',
    mannequins: [
      { name: 'close:1', look: 'skin:zombie', team: NO_TEAM, pose: 'stand', weapon: '' },
      { name: 'close:5', look: LOOK_SHORT, team: TEAM_A, pose: 'stand', weapon: '', expression: 0 },
    ],
  });

  // (15) Mira: agachado atrás da cobertura mirando para cima (+0,6 e +1,2 rad), em pé para cima e para baixo, e o ADS
  // de 3ª pessoa (G14).
  const aim = (name: string, pose: MannequinPose, pitch: number): MannequinOverride[] => [
    { name, look: 'skin:recruit', team: NO_TEAM, pose, weapon: 'rifle', pitch },
  ];
  for (const [slug, camera, pitch, label] of [
    ['agachado-cima-06', 'print:altura', 0.6, 'de perfil, mira +0,6 rad (os braços saturam)'],
    ['agachado-cima-12', 'print:altura', 1.2, 'de perfil, mira +1,2 rad'],
    ['agachado-cima-12-45', 'print:altura-45', 1.2, 'a 45°, mira +1,2 rad'],
  ] as const) {
    hd('mira', slug, `Agachado atrás da cobertura de 1,0 m, ${label}`, {
      camera,
      mannequins: aim('altura:agachado', 'crouch', pitch),
    });
  }
  hd('mira', 'em-pe-cima', 'Em pé de perfil, mira +1,2 rad (cabeça até 0,6)', {
    camera: 'print:altura',
    mannequins: aim('altura:em-pe', 'stand', 1.2),
  });
  hd('mira', 'em-pe-baixo', 'Em pé de perfil, mira −1,2 rad', {
    camera: 'print:altura',
    mannequins: aim('altura:em-pe', 'stand', -1.2),
  });
  hd('mira', 'em-pe-ads', 'Em pé de perfil, ADS de 3ª pessoa (antebraço de 6 px)', {
    camera: 'print:altura',
    mannequins: aim('altura:em-pe', 'aim', 0),
  });

  // (16) e (17) Quadros com dt fixo: o 4º da fila, armado e do time A.
  const clipShot = (set: PrintSetId, slug: string, clip: FigureClipId, frame: number, label: string): void => {
    const ms = Math.round(frame * CLIP_DT_S * 1000);
    hd(set, slug, `${label}: quadro ${frame} (${ms} ms a dt 1/60) depois do evento`, {
      camera: CLIP_CAMERA,
      mannequins: [{ name: CLIP_MANNEQUIN, look: LOOK_SHORT, team: TEAM_A, pose: 'stand', weapon: 'rifle', pitch: 0 }],
      clip: { mannequin: CLIP_MANNEQUIN, clip, frame, dtS: CLIP_DT_S },
    });
  };
  for (const [slug, clip, frame, label] of SEQUENCE_FRAMES) clipShot('sequencia', slug, clip, frame, label);
  for (const [slug, clip, frame, label] of WALK_FRAMES) clipShot('andar', slug, clip, frame, label);
  return plan;
}

/**
 * A sequência do passo 6 (arrancar, parar, ADAD, pular, pousar, levar dano): o quadro de cada clipe onde o balanço
 * aparece mais (a freada e o arranque a 0,15 s, o ADAD logo depois da 1ª virada, o pulo no recolhido, o pouso no
 * achatamento, o dano no tranco).
 */
export const SEQUENCE_FRAMES: readonly (readonly [string, FigureClipId, number, string])[] = [
  ['arrancar', 'start', 9, 'Arrancar'],
  ['parar', 'stop', 9, 'Parar'],
  ['adad', 'strafe', 20, 'ADAD (0,25 s por lado)'],
  ['pular', 'jump', 12, 'Pular'],
  ['pousar', 'land', 2, 'Pousar'],
  ['dano', 'hit', 6, 'Levar dano'],
];
/** G13: o andar em regime (0,5 s depois de começar). */
export const WALK_FRAMES: readonly (readonly [string, FigureClipId, number, string])[] = [
  ['frente', 'walk', 30, 'Andando para a frente'],
  ['lado', 'sidestep', 30, 'Andando de lado'],
  ['re', 'backpedal', 30, 'Andando de ré'],
];

/** Os looks da farda a 1 m sem time (R4: o camuflado de perto): o recruta (woodland) e o Black power (deserto). */
const FARDA_NO_TEAM: readonly PrintLook[] = ['skin:recruit', 'skin:blackpower'];

/**
 * A tropa sem time: os 7 primeiros looks da fila e o zumbi. A reserva de 32 skins já vai quase cheia com a fila dos
 * prints nos times A e B (31 conjuntos no PC): os 6 primeiros (a rotação dos bots do PC) e o zumbi já têm skin sem
 * time no loading, o 7º sai sob demanda na vaga que sobra. Um look a mais vestiria o recruta (o padrão sem vaga).
 */
export const TROPA_NO_TEAM: readonly PrintLook[] = [...FILA_LOOKS.slice(0, 7), 'skin:zombie'];

/**
 * Rodada 4 (roupa militar, #58): a tropa de frente e de costas nos 2 times (6) e sem time (1), a farda a 1 m de frente
 * e de costas nos 2 times e sem time (3), a vitrine (1) e o zumbi (2): 13 prints em 1280×720, mais a leitura (9).
 */
function round4Shots(): SceneShot[] {
  const plan: SceneShot[] = [];
  const hd = (set: PrintSetId, slug: string, caption: string, settings: Partial<PrintSettings>): void => {
    plan.push(sceneShot(set, slug, caption, SIZE_HD, settings));
  };

  // (19) Tropa: os 12 looks em 3 páginas de 4 nos times A (linha:1..4) e B (linha:5..8), de frente e de costas; depois
  // sem time, os 8 de `TROPA_NO_TEAM` de frente.
  for (let page = 0; page < 3; page++) {
    const mannequins = filaPage(page);
    const range = `${page * 4 + 1}–${page * 4 + 4}`;
    for (const [slug, camera, label] of FILA_CAMERAS) {
      if (slug === '3-4') continue;
      hd('tropa', `${slug}-${page + 1}`, `Tropa ${label}, looks ${range} (linha 1–4 time A, 5–8 time B)`, {
        camera,
        mannequins,
      });
    }
  }
  hd('tropa', 'sem-time', 'Tropa de frente sem time (FFA e vitrine): looks 1–7 e o zumbi', {
    camera: 'print:linha-frente',
    mannequins: TROPA_NO_TEAM.map((look, k): MannequinOverride => ({
      name: LINE(k + 1),
      look,
      team: NO_TEAM,
      pose: 'stand',
      weapon: '',
      pitch: 0,
      expression: 0,
    })),
  });

  // (20) Farda a 1 m: de frente e de costas (time A no Clássico, time B no Black power) e sem time (camuflados).
  hd('farda', 'frente-1m', 'Farda a 1 m de frente: time A (Clássico, urbano) e time B (Black power, deserto)', {
    camera: 'print:close-1m',
    mannequins: closePair(0),
  });
  hd('farda', 'costas-1m', 'Farda a 1 m de costas: o colete com o ícone, o cinto e a braçadeira', {
    camera: 'print:close-1m',
    mannequins: closePair(180),
  });
  hd('farda', 'sem-time-1m', 'Farda a 1 m sem time: recruta (woodland) e Black power (deserto), colete do look', {
    camera: 'print:close-1m',
    mannequins: closePair(0, { look: FARDA_NO_TEAM[0]!, team: NO_TEAM }, { look: FARDA_NO_TEAM[1]!, team: NO_TEAM }),
  });

  // (21) Pátio: a vitrine armada do mapa (coletes A e B e o zumbi), ao dia.
  hd('patio', 'armada', 'Vitrine armada ao dia, com a farda', { camera: 'print:dia' });

  // (22) Zumbi de farda velha: de frente na fila (linha 4) e o rosto a 1 m ao lado de um bobo do time A.
  hd('infectado', 'frente', 'Zumbi de farda velha de frente na fila (linha 4), entre os soldados', {
    camera: 'print:linha-frente',
    mannequins: [{ name: LINE(4), look: 'skin:zombie', team: NO_TEAM, pose: 'stand', weapon: '' }],
  });
  hd('infectado', 'rosto-1m', 'Zumbi a 1 m (rasgos, remendos e curativos), ao lado do bobo do time A', {
    camera: 'print:close-1m',
    mannequins: [
      { name: 'close:1', look: 'skin:zombie', team: NO_TEAM, pose: 'stand', weapon: '' },
      { name: 'close:5', look: LOOK_SHORT, team: TEAM_A, pose: 'stand', weapon: '', expression: 0 },
    ],
  });
  return plan;
}

/** Prints que só existem como variante da cópia (a árvore principal não os tem nem como base): os bots numa partida. */
function copyOnlyBaseShots(): SceneShot[] {
  return [
    sceneShot(
      'bots',
      'partida',
      'Partida com 12 bots no perfil do PC, na vista do jogador com HUD',
      SIZE_HD,
      { camera: null, hud: true },
      { bots: 12, profile: 'pc' },
    ),
  ];
}

// --- Cópia descartável (passo 6) ---

export interface CopyVariant {
  readonly id: CopyVariantId;
  /** Pergunta do §G que a variante responde. */
  readonly question: RoundQuestionId;
  /** O que muda na cópia descartável (`%TEMP%\bf-<marca>`, como na rodada 1). */
  readonly change: string;
  /** Prints (conjunto, slug) que a cópia repete com `npm run prints -- --copia <id>`. */
  readonly repeats: readonly (readonly [PrintSetId, string])[];
  /** O que gravar à mão além dos prints (`null` = só prints). */
  readonly video: string | null;
}

const SEQUENCE_REPEATS = SEQUENCE_FRAMES.map(([slug]) => ['sequencia', slug] as const);
const CROUCH_REPEATS = [
  ['regua', 'classico-perfil'],
  ['regua', 'classico-45'],
  ['mira', 'agachado-cima-06'],
] as const;
const HAIR_REPEATS = [
  ['regua', 'blackpower-perfil'],
  ['regua', 'afro-perfil'],
  ['regua', 'bone-perfil'],
  ['regua', 'cabelos-agachados-perfil'],
] as const;

export const COPY_VARIANTS: readonly CopyVariant[] = [
  {
    id: 'h5',
    question: 'G2',
    change: 'proporção H5: cabeça de 0,5 m e corpo achatado em 24 px = 1,25 m (o headshot de hoje)',
    repeats: [
      ['fila', 'frente-1'],
      ['fila', 'frente-2'],
      ['fila', 'frente-3'],
      ['regua', 'classico-perfil'],
    ],
    video: null,
  },
  {
    id: 'pf',
    question: 'G4',
    change: 'agachado PF refeito (tronco a 23°, quase sentado nos calcanhares; sola de 2,7 px e cabeça limitada)',
    repeats: CROUCH_REPEATS,
    video: null,
  },
  {
    id: 'p1',
    question: 'G4',
    change: 'agachado P1 (tronco a 41°)',
    repeats: CROUCH_REPEATS,
    video: null,
  },
  {
    id: 'cabelo-aceitar',
    question: 'G5',
    change: 'cabelo sem recorte, opção (a) "aceitar": passa da cobertura agachado e da porta em pé',
    repeats: HAIR_REPEATS,
    video: null,
  },
  {
    id: 'cabelo-achatar',
    question: 'G5',
    change: 'cabelo achatado a partir do topo da cabeça, opção (b)',
    repeats: HAIR_REPEATS,
    video: null,
  },
  {
    id: 'molas-cheias',
    question: 'G6',
    change: 'molas cheias do FutBobo, sem o envelope (a cabeça vai 0,3 m de lado no ADAD)',
    repeats: SEQUENCE_REPEATS,
    video: 'vídeo curto lado a lado, cópia × árvore principal: ADAD, arranque, freada e pulo',
  },
  {
    id: 'capacete',
    question: 'G1',
    change: 'capacete em casca na reserva da camada 1 (com o `uOuterMaxDist`)',
    repeats: [
      ['vitrine', 'armada'],
      ['close', 'frente-1m'],
    ],
    video: null,
  },
  {
    id: 'grao',
    question: 'G10',
    change: 'grão de ±5% na roupa (o da decisão #51 no bobo A)',
    repeats: [
      ['close', 'frente-1m'],
      ['close', 'costas-1m'],
    ],
    video: null,
  },
  {
    id: 'antebraco',
    question: 'G14',
    change: 'antebraço +1 px (6 → 7): a mira do ADS de 3ª pessoa chega ao olho',
    repeats: [['mira', 'em-pe-ads']],
    video: null,
  },
  {
    id: 'bots-visuais',
    question: 'G8',
    change:
      'teto `figureBotLooks` liberado e a rotação dos bots em 3, 6 e 11 visuais (uma rodada da cópia para cada,' +
      ' com `--marca bots-<n>`)',
    repeats: [['bots', 'partida']],
    video: null,
  },
];

function copyShots(bases: readonly PrintShot[]): PrintShot[] {
  const out: PrintShot[] = [];
  for (const v of COPY_VARIANTS) {
    for (const [set, slug] of v.repeats) {
      const base = bases.find((s) => s.set === set && s.slug === slug);
      if (!base) throw new Error(`variante ${v.id}: o print ${set}/${slug} não existe no roteiro`);
      out.push({
        ...base,
        file: fileName(set, slug, base, v.id),
        caption: `${base.caption} · CÓPIA ${v.id}: ${v.change}`,
        copy: v.id,
      });
    }
  }
  return out;
}

/**
 * O roteiro completo: as escolhas (29 prints: 1280×720 em todos e 640×360 onde a tela pequena muda a leitura; a
 * leitura de bobos SÓ em 640×360, como pede o GDD), a rodada 3 da árvore principal (40 em 1280×720), a rodada 4 (13
 * em 1280×720; a leitura é a mesma) e, por último, as 30 variantes da cópia descartável (`copy` não nulo).
 */
export function buildPrintPlan(): PrintShot[] {
  const main = [...choiceShots(), ...round3Shots(), ...round4Shots()];
  return [...main, ...copyShots([...main, ...copyOnlyBaseShots()])];
}

/** Conjunto pertence à rodada? */
export const inRound = (set: PrintSetId, round: PrintRound): boolean => setInfo(set).rounds.includes(round);

/**
 * Filtra o roteiro por conjunto (`--so hora,leitura`), pelo número (`--so 4`) ou pela rodada (`--so rodada3`); lista
 * vazia = tudo. Nome desconhecido lança.
 */
export function filterPlan(plan: readonly PrintShot[], only: readonly string[]): PrintShot[] {
  const wanted = only.map((s) => s.trim()).filter((s) => s !== '');
  for (const id of wanted) {
    const known =
      PRINT_ROUNDS.includes(id as PrintRound) || PRINT_SETS.some((s) => s.id === id || String(s.number) === id);
    if (!known) {
      const names = [...PRINT_ROUNDS, ...PRINT_SETS.map((s) => s.id)].join(', ');
      throw new Error(`conjunto de prints desconhecido: ${id} (use ${names})`);
    }
  }
  if (wanted.length === 0) return [...plan];
  const ids = new Set(
    PRINT_SETS.filter(
      (s) => wanted.includes(s.id) || wanted.includes(String(s.number)) || s.rounds.some((r) => wanted.includes(r)),
    ).map((s) => s.id),
  );
  return plan.filter((p) => ids.has(p.set));
}

/** Os prints de uma variante da cópia (`--copia <id>`). Variante desconhecida lança. */
export function copyPlan(plan: readonly PrintShot[], variant: string): PrintShot[] {
  if (!COPY_VARIANTS.some((v) => v.id === variant)) {
    throw new Error(`variante da cópia desconhecida: ${variant} (use ${COPY_VARIANTS.map((v) => v.id).join(', ')})`);
  }
  return plan.filter((p) => p.copy === variant);
}

/** Membros do gancho novo que o print precisa (vazio = o `GameDebugApi` de hoje basta). */
export function shotNeeds(shot: PrintShot): (keyof FigurePrintHook)[] {
  if (shot.page !== 'scene') return [];
  const needs: (keyof FigurePrintHook)[] = [];
  if (shot.settings.mannequins.length > 0) needs.push('setMannequins');
  if (shot.settings.clip !== null) needs.push('setFigureClip');
  return needs;
}

const cleanName = (s: string): string => s.replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Pasta da rodada: `<versão>[-<marca>]` dentro da pasta de saída (padrão `local/m1/prints/`; `--saida` muda, para a
 * cópia descartável das variantes gravar na árvore principal). A marca separa rodadas da mesma versão (`altura-a`).
 */
export function printDirName(version: string, tag: string | null): string {
  const v = cleanName(version) || 'sem-versao';
  const t = tag ? cleanName(tag) : '';
  return t ? `${v}-${t}` : v;
}

/** Marca da rodada contra a página falsa: `falso` na frente da marca pedida (nunca mistura com uma rodada de verdade). */
export function fakeTag(tag: string | null): string {
  const t = tag ? cleanName(tag) : '';
  return t ? `falso-${t}` : 'falso';
}

/**
 * Query da página de cena: bench parado numa vista, sem bots nem zumbis, visão de 90 m (o print de leitura vai até
 * 50 m e a fog do 3–4P esconderia o bobo de 50 m), sem aquecimento e com uma hora de duração (o bench não acaba no
 * meio dos prints). `atlas`: a rota do atlas do plano B. `bots` e `profile`: só a variante dos visuais dos bots.
 */
export function printsQuery(scene: string, atlas = false, bots = 0, profile: string | null = null): string {
  return (
    `?bench&scene=${encodeURIComponent(scene)}&views=1&bots=${bots}&zombies=0&view=90&warmup=0&duration=3600&seed=1` +
    (profile ? `&profile=${encodeURIComponent(profile)}` : '') +
    (atlas ? '&atlas=1' : '') +
    (PRINTS_LOADING_PARAM ? `&${PRINTS_LOADING_PARAM}=1` : '')
  );
}

/** Query da prévia do título do Switch na casca web (`apps/web/src/title-preview.ts` lê a mesma chave). */
export const SWITCH_TITLE_QUERY = '?titulo=switch';

/** Query da página de um print (`''` = a página inicial, o título da web de verdade). */
export function shotQuery(shot: PrintShot, scene: string): string {
  if (shot.page === 'scene') return printsQuery(scene, shot.atlas, shot.bots, shot.profile);
  return shot.shell === 'switch' ? SWITCH_TITLE_QUERY : '';
}

/**
 * Ordem de execução: agrupa os prints pela página (uma carga de página por grupo; o Construto leva segundos para
 * carregar), na ordem em que cada página aparece no roteiro e mantendo a ordem do roteiro dentro do grupo. A folha de
 * contato continua na ordem do roteiro.
 */
export function runOrder(plan: readonly PrintShot[], scene: string): PrintShot[] {
  const groups = new Map<string, PrintShot[]>();
  for (const shot of plan) {
    const key = shotQuery(shot, scene);
    const group = groups.get(key);
    if (group) group.push(shot);
    else groups.set(key, [shot]);
  }
  return [...groups.values()].flat();
}

// --- Perguntas das rodadas 3 (PLANO do porte §G) e 4 (roupa militar, #58) ---

export type RoundQuestionId = `G${number}` | `R${number}`;

export interface RoundQuestion {
  readonly id: RoundQuestionId;
  readonly title: string;
  readonly text: string;
  readonly options: readonly string[];
  /** Índice da opção que já está no código (o padrão). */
  readonly default: number;
  /** Onde ver na árvore principal. */
  readonly sets: readonly PrintSetId[];
  /** Variantes da cópia descartável que mostram as outras opções. */
  readonly copies: readonly CopyVariantId[];
  /** A coluna "Print" do §G. */
  readonly evidence: string;
}

export const ROUND3_QUESTIONS: readonly RoundQuestion[] = [
  {
    id: 'G1',
    title: 'Capacete por cima?',
    text: 'Ficou sem escolha na rodada 2. A reserva 64×32 da camada 1 e o `uOuterMaxDist` já estão prontos.',
    options: ['Sem capacete', 'Casca na reserva da camada 1', 'Acessório 3D'],
    default: 0,
    sets: ['vitrine'],
    copies: ['capacete'],
    evidence: 'Vitrine com e sem casca (cópia)',
  },
  {
    id: 'G2',
    title: 'Proporção',
    text: 'O FutBobo como é (U: cabeça de 0,44 m, 4 cabeças) ou a cabeça de 0,5 m (H5, mais "cabeçudo", headshot de hoje)?',
    options: ['U (o FutBobo como é)', 'H5 (cabeça de 0,5 m)'],
    default: 0,
    sets: ['fila', 'regua'],
    copies: ['h5'],
    evidence: 'Fila U × H5 lado a lado (cópia)',
  },
  {
    id: 'G3',
    title: 'Headshot',
    text:
      'Com a cabeça menor (0,4375 m), o balance mediu headshot de 57,6% → 44,5% no Normal (Tryhard 66,1% → 59,4%) e' +
      ' TTK 20–30% maior (Normal 1,21 → 1,57 s). Os 5 níveis seguem em ordem. Manter os multiplicadores ou devolver o' +
      ' TTK?',
    options: ['Manter (1,5 / 2,0 / 1,25)', 'Devolver o TTK'],
    default: 0,
    sets: [],
    copies: [],
    evidence: 'Tabela do balance (`npm run balance`, no PERF.md)',
  },
  {
    id: 'G4',
    title: 'Agachado',
    text:
      'P4f (tronco a 37°, pescoço afundado meia cabeça, topo 0,94 m) × PF (tronco a 23°, quase sentado nos' +
      ' calcanhares) × P1 (41°).',
    options: ['P4f', 'PF', 'P1'],
    default: 0,
    sets: ['regua', 'mira'],
    copies: ['pf', 'p1'],
    evidence: 'Régua com P4f × PF × P1, armados, de perfil e a 45°',
  },
  {
    id: 'G5',
    title: 'Cabelo alto acima da cobertura',
    text: '26 de 34 cortes passam da cobertura agachados; 2 passam da porta em pé.',
    options: ['(a) aceitar', '(b) achatar', '(c) recortar no teto de 0,99 m / 1,99 m'],
    default: 2,
    sets: ['regua'],
    copies: ['cabelo-aceitar', 'cabelo-achatar'],
    evidence: 'Régua com black power, afro gigante e boné agachados: os 3 lado a lado',
  },
  {
    id: 'G6',
    title: 'Molas',
    text:
      'O balanço do FutBobo dentro de um envelope (a cabeça anda no máximo 1 px parada e 2 px no pico) ou as molas' +
      ' cheias do FutBobo (a cabeça vai 0,3 m de lado no ADAD)?',
    options: ['Envelope, com os ganhos no teto', 'Molas cheias do FutBobo'],
    default: 0,
    sets: ['sequencia'],
    copies: ['molas-cheias'],
    evidence: 'Vídeo curto lado a lado: ADAD, arranque, freada e pulo',
  },
  {
    id: 'G7',
    title: 'Cabeça presa ao olho',
    text:
      'O tronco não inclina com a mira; a cabeça gira até 0,6 rad em pé (0,1 agachada) e desliza até 1,5 px; agachado,' +
      ' os braços param em +0,6 rad e o cano pode aparecer acima da cobertura.',
    options: ['Assim', 'Cabeça até 0,84 rad (desvio até 2,3 px)', 'Tronco a 15% do pitch (desvio ~3 px)'],
    default: 0,
    sets: ['mira'],
    copies: [],
    evidence: 'Mirando para cima e para baixo, de perfil; agachado mirando para cima atrás da cobertura',
  },
  {
    id: 'G8',
    title: 'Visuais dos bots',
    text:
      'Switch com as 3 prontas por time (10 skins); PC com 3 prontas + 3 visuais do FutBobo (19). Cada visual a mais' +
      ' soma 3 skins (~50 ms de loading no Eden).',
    options: ['Assim', 'Mais visuais no PC', 'Menos visuais'],
    default: 0,
    sets: ['fila'],
    copies: ['bots-visuais'],
    evidence: 'Partida com bots: 3 × 6 × 11 visuais (cópia)',
  },
  {
    id: 'G9',
    title: 'Camisa',
    text: 'Lisa na cor do time nos modos com time (estampa só no FFA)? Número no peito 3×5? Escudo ou ícone de time?',
    options: [
      'Lisa; número no peito ligado; escudo',
      'Lisa; sem número no peito; escudo',
      'Lisa; número; ícone',
      'Estampa também nos modos com time',
    ],
    default: 0,
    sets: ['close', 'leitura', 'fila'],
    copies: [],
    evidence: 'Close de 1 m de frente e de costas; leitura de 5 a 50 m',
  },
  {
    id: 'G10',
    title: 'Grão de ±5% na roupa',
    text: 'A #51 aprovou o grão no bobo A; o FutBobo é chapado.',
    options: ['Desligado', 'Ligado'],
    default: 0,
    sets: ['close'],
    copies: ['grao'],
    evidence: 'Close com e sem (cópia)',
  },
  {
    id: 'G11',
    title: 'Zumbi',
    text: 'FutBobo esverdeado e curvado, com o rosto pintado na skin (espiral, língua), ou volta o bobo A?',
    options: ['Zumbi FutBobo', 'Volta o bobo A'],
    default: 0,
    sets: ['vitrine', 'zumbi'],
    copies: [],
    evidence: 'Vitrine com o zumbi e o rosto a 1 m',
  },
  {
    id: 'G12',
    title: 'Deslize "carrinho"',
    text: 'Deitado para trás, perna da frente esticada, topo 0,93 m.',
    options: ['Carrinho', 'Outro deslize'],
    default: 0,
    sets: ['regua'],
    copies: [],
    evidence: 'Manequim `altura:deslizando` de perfil',
  },
  {
    id: 'G13',
    title: 'Andar de lado e de ré',
    text: 'O passinho do goleiro no strafe e a passada invertida na ré.',
    options: ['Isso', 'Outro andar'],
    default: 0,
    sets: ['andar'],
    copies: [],
    evidence: '3 quadros congelados (frente, lado, ré)',
  },
  {
    id: 'G14',
    title: 'Antebraço +1 px',
    text: '6 → 7 px: a mira do ADS de 3ª pessoa chega ao olho, quase sem mudar a silhueta.',
    options: ['Não (proporção do FutBobo)', 'Sim (+1 px)'],
    default: 0,
    sets: ['mira'],
    copies: ['antebraco'],
    evidence: 'ADS de 3ª pessoa com e sem (cópia)',
  },
  {
    id: 'G15',
    title: 'Braço armado na frente do peito',
    text: 'Leva dano de braço (0,8×). Manter ou subir o braço para 1,0, como em muitos FPS?',
    options: ['Manter 0,8 e medir o TTK', 'Subir para 1,0'],
    default: 0,
    sets: [],
    copies: [],
    evidence: 'Tabela do balance',
  },
  {
    id: 'G16',
    title: 'Comemorações e tiques do FutBobo (42 + 7)',
    text: 'Entram no M2, com emote do placar e no fim da partida?',
    options: ['Depois (M2, com contrato de emote)', 'Agora'],
    default: 0,
    sets: [],
    copies: [],
    evidence: '—',
  },
];

/** Registro sem pergunta, mostrado junto das perguntas (PLANO do porte §B20 e o fim do §G). */
export const ROUND3_NOTES: readonly string[] = [
  'Camisa em pixel art Nearest, no lugar do vetor linear do FutBobo (a maior mudança visual).',
  'Sem sombra projetada da cabeça no peito, sem especular nem metal; ouro e braçadeira são tom de paleta.',
  'Sola 0,1 px maior: o FutBobo flutuava 5,5 mm.',
  'Membros lisos por amostra de paleta, como no FutBobo.',
  'Molas no envelope (G6), giro preguiçoso só nas pernas e até 0,35 rad.',
  'Cabeça presa ao olho (G7).',
  'Meia taxa de pose além de 20 m no Switch.',
  'Comemorações e tiques só no M2 (G16).',
  'Recarga: o braço E sai da hitbox, como hoje.',
  'Piscar automático do FutBobo ligado; os manequins não piscam.',
];

/** As 4 perguntas da rodada 4 (roupa militar, #58), no formato do §G, com o padrão (o que está no código) marcado. */
export const ROUND4_QUESTIONS: readonly RoundQuestion[] = [
  {
    id: 'R1',
    title: 'Roupas militares',
    text:
      'Sai o uniforme de futebol (#58): jaqueta e calça (lisa ou camuflada: woodland, deserto, urbano, noturno; o' +
      ' mecânico de macacão com graxa, o piloto de macacão de voo), gola mais escura, colete com porta-carregadores,' +
      ' cinto, luvas e botas de combate. Cabeça, rosto, cabelo, esqueleto e animação do FutBobo como estão. Aprovadas?',
    options: ['Aprovadas', 'Aprovadas, com ajustes no comentário', 'Refazer'],
    default: 0,
    sets: ['tropa', 'farda', 'patio', 'infectado'],
    copies: [],
    evidence: 'Tropa de frente, de costas e sem time; farda a 1 m; vitrine; zumbi',
  },
  {
    id: 'R2',
    title: 'Colete de time',
    text:
      'Com time, o colete de time (e o cinto) cobre o tronco na cor do time, com o ícone ▲ ● ■ ◆ de 5×5 na tinta' +
      ' legível num painel escuro no peito e nas costas; sem time, o colete do look é uma placa menor, na cor dele e' +
      ' sem ícone. Ícone ou só a cor?',
    options: ['Cor e ícone', 'Só a cor'],
    default: 0,
    sets: ['farda', 'tropa', 'leitura'],
    copies: [],
    evidence: 'Farda a 1 m de frente e de costas; leitura de 5 a 50 m',
  },
  {
    id: 'R3',
    title: 'Luvas e braçadeira do time',
    text:
      'Com time: luvas, braçadeira (na manga) e joelheiras na cor do time, junto do colete (a cor do time cobre 38,1–' +
      '39,0% da frente). Sem time: luva e joelheira do look, sem braçadeira.',
    options: ['Luvas, braçadeira e joelheiras do time', 'Só as luvas', 'Só o colete'],
    default: 0,
    sets: ['farda', 'tropa', 'leitura'],
    copies: [],
    evidence: 'Farda a 1 m; tropa de frente e de costas; leitura de 30 e 50 m',
  },
  {
    id: 'R4',
    title: 'Camuflado',
    text:
      'O camuflado vai só no tronco (a única peça com textura cheia); mangas e calça ficam no tom principal do tecido,' +
      ' lisas como os membros do FutBobo. Com o colete de time por cima, ele aparece nos ombros e nos lados; sem time,' +
      ' também em volta do colete. Assim, ou também nas pernas (e braços)?',
    options: ['Só no tronco', 'Também nas pernas', 'Também nas pernas e nos braços'],
    default: 0,
    sets: ['tropa', 'farda'],
    copies: [],
    evidence: 'Tropa sem time; farda a 1 m sem time (woodland e deserto)',
  },
];

/** Registro sem pergunta da rodada 4 (decisões menores da roupa militar, revisáveis). */
export const ROUND4_NOTES: readonly string[] = [
  'Dois coletes: o de time (com time) cobre o tronco, para a cor do time passar de 35% da frente; o do look (sem time)' +
    ' é uma placa menor, para o camuflado aparecer em volta.',
  'Manga comprida até a luva: o antebraço deixou de ser pele (o braço da 1ª pessoa também).',
  'Manga, antebraço, coxa e canela leem colunas de 4 t (como as do zumbi), para a braçadeira, o punho da luva e a' +
    ' joelheira; o zumbi usa as mesmas colunas, pintadas rasgadas.',
  'O cinto do equipamento acompanha o colete (na cor do time com time); sem colete, cinto escuro com fivela.',
  'Jaqueta, calça, botas, colete e luvas do look também passam pela trava de cor (92 redmean de um time).',
  'Na projeção de frente de verdade (com o cabelo), a cor do time fica em 32,8–38,2%: a barba longa cobre o painel e o' +
    ' afro aumenta a silhueta.',
];

/** As perguntas e o registro de cada rodada com folha de perguntas. */
export const ROUND_SHEETS = [
  {
    round: 'rodada3',
    title: 'Perguntas da rodada 3 (porte do boneco do FutBobo, #56)',
    questions: ROUND3_QUESTIONS,
    notes: ROUND3_NOTES,
  },
  {
    round: 'rodada4',
    title: 'Perguntas da rodada 4 (roupa militar, #58)',
    questions: ROUND4_QUESTIONS,
    notes: ROUND4_NOTES,
  },
] as const satisfies readonly {
  readonly round: PrintRound;
  readonly title: string;
  readonly questions: readonly RoundQuestion[];
  readonly notes: readonly string[];
}[];

/** O conjunto é exclusivo da rodada (fora das escolhas e das outras rodadas com perguntas)? */
export function onlyInRound(set: PrintSetId, round: PrintRound): boolean {
  const rounds = setInfo(set).rounds;
  return rounds.includes(round) && !rounds.includes('escolhas');
}

/** As rodadas com perguntas que os prints dados tocam (por um conjunto exclusivo delas), na ordem de `ROUND_SHEETS`. */
export function roundsWithQuestions(shots: readonly PrintShot[]): PrintRound[] {
  return ROUND_SHEETS.filter((s) => shots.some((p) => onlyInRound(p.set, s.round))).map((s) => s.round);
}

/** As perguntas das rodadas tocadas pelos prints (para o `prints.json`). */
export function questionsFor(shots: readonly PrintShot[]): RoundQuestion[] {
  const rounds = roundsWithQuestions(shots);
  return ROUND_SHEETS.filter((s) => rounds.includes(s.round)).flatMap((s) => [...s.questions]);
}

// --- Folha de contato ---

/**
 * Status de um print: `pendente` = falta peça do passo 5 (gancho novo, câmera ou manequim da rodada 3); `copia` = só
 * existe na cópia descartável (a árvore principal deixa o lugar marcado).
 */
export type ShotStatus = 'ok' | 'sem-camera' | 'falhou' | 'pendente' | 'copia';

export interface ShotResult {
  readonly shot: PrintShot;
  readonly status: ShotStatus;
  /** Detalhe da falha (pt-BR). */
  readonly detail?: string;
}

export interface ContactSheet {
  readonly version: string;
  /** Marca da rodada (`--marca`), ou `null`. */
  readonly tag: string | null;
  readonly createdAt: string;
  readonly browser: string;
  readonly url: string;
  readonly fake: boolean;
  /** Variante da cópia descartável desta rodada (`--copia`), ou `null` na árvore principal. */
  readonly copy?: CopyVariantId | null;
  readonly results: readonly ShotResult[];
  readonly problems: readonly string[];
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Texto escapado com os trechos entre crases como `<code>` (nomes de código nas perguntas e nas variantes). */
const richText = (text: string): string => escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');

/** Comando que gera os prints de uma variante na cópia descartável. */
export const copyCommand = (variant: CopyVariantId): string => `npm run prints -- --copia ${variant} --saida <pasta>`;

/** As perguntas (e o registro) de cada rodada pedida, num formulário só, com o padrão marcado. */
function questionsHtml(rounds: readonly PrintRound[]): string {
  const sheets = ROUND_SHEETS.filter((s) => rounds.includes(s.round));
  const questions: RoundQuestion[] = sheets.flatMap((s) => [...s.questions]);
  const setTitle = (id: PrintSetId): string => {
    const s = setInfo(id);
    return `<a href="#${s.id}">${s.number}. ${escapeHtml(s.title)}</a>`;
  };
  const block = (q: RoundQuestion): string => {
    const options = q.options
      .map(
        (o, i) =>
          `<label><input type="radio" name="${q.id}" value="${i}"${i === q.default ? ' checked' : ''}> ` +
          `${escapeHtml(o)}${i === q.default ? ' <em>(padrão, já no código)</em>' : ''}</label>`,
      )
      .join('');
    const where = [...q.sets.map(setTitle), ...q.copies.map((c) => `cópia <code>${escapeHtml(c)}</code>`)].join(' · ');
    return (
      `<fieldset class="pergunta" id="q-${q.id}"><legend>${q.id}. ${escapeHtml(q.title)}</legend>` +
      `<p>${richText(q.text)}</p><div class="opcoes">${options}</div>` +
      `<p class="ev">Print: ${richText(q.evidence)}${where ? ` · ${where}` : ''}</p>` +
      `<textarea name="${q.id}-nota" rows="2" placeholder="Comentário (opcional)"></textarea></fieldset>`
    );
  };
  const data = questions.map((q) => ({ id: q.id, title: q.title, options: q.options, default: q.default }));
  const heading = sheets.map((s) => s.title).join(' · ');
  // O JSON vai dentro de <script>: `<` escapado para nenhum texto fechar a tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const headingJson = JSON.stringify(`Respostas: ${heading}`).replace(/</g, '\\u003c');
  const groups = sheets
    .map(
      (s) =>
        `<h3>${escapeHtml(s.title)}</h3>\n${s.questions.map(block).join('\n')}\n` +
        `<h4>Registro sem pergunta (diferenças conscientes)</h4>` +
        `<ul class="notas">${s.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`,
    )
    .join('\n');
  return `<section id="perguntas"><h2>${escapeHtml(heading)}</h2>
<p class="q">Cada pergunta já vem com o padrão marcado (é o que está no código). Mude só o que quiser; as respostas
ficam salvas neste navegador e o resumo no fim vai pronto para colar na conversa.</p>
<form id="respostas">
${groups}
</form>
<p><button type="button" id="copiar">Copiar as respostas</button></p>
<textarea id="resumo" rows="20" readonly aria-label="Resumo das respostas"></textarea>
<script>
(function () {
  var questions = ${json};
  var form = document.getElementById('respostas');
  var out = document.getElementById('resumo');
  var key = 'bf-${rounds.join('+')}:' + location.pathname;
  function update() {
    var lines = [${headingJson}];
    var state = {};
    questions.forEach(function (q) {
      var picked = form.querySelector('input[name="' + q.id + '"]:checked');
      var i = picked ? Number(picked.value) : q.default;
      var note = form.elements[q.id + '-nota'].value.trim();
      state[q.id] = { i: i, note: note };
      var mark = i === q.default ? ' (padrão)' : ' (MUDOU; o padrão era: ' + q.options[q.default] + ')';
      lines.push(q.id + ' ' + q.title + ': ' + q.options[i] + mark + (note ? ' · ' + note : ''));
    });
    out.value = lines.join('\\n');
    try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {}
  }
  try {
    var saved = JSON.parse(localStorage.getItem(key) || '{}');
    questions.forEach(function (q) {
      var s = saved[q.id];
      if (!s) return;
      var input = form.querySelector('input[name="' + q.id + '"][value="' + s.i + '"]');
      if (input) input.checked = true;
      form.elements[q.id + '-nota'].value = s.note || '';
    });
  } catch (e) {}
  form.addEventListener('change', update);
  form.addEventListener('input', update);
  document.getElementById('copiar').addEventListener('click', function () {
    out.select();
    if (navigator.clipboard) navigator.clipboard.writeText(out.value).catch(function () { document.execCommand('copy'); });
    else document.execCommand('copy');
  });
  update();
})();
</script>
</section>`;
}

/** Folha de contato local (`index.html` ao lado dos PNG): abrir no navegador e comparar lado a lado. */
export function contactSheetHtml(sheet: ContactSheet): string {
  const sections = PRINT_SETS.map((set) => {
    const items = sheet.results.filter((r) => r.shot.set === set.id);
    if (items.length === 0) return '';
    const figures = items
      .map((r) => {
        const caption = escapeHtml(r.shot.caption);
        let body: string;
        if (r.status === 'ok') {
          body = `<a href="${escapeHtml(r.shot.file)}"><img src="${escapeHtml(r.shot.file)}" width="${r.shot.width}" height="${r.shot.height}" loading="lazy" alt="${caption}"></a>`;
        } else if (r.status === 'copia' && r.shot.copy) {
          const variant = COPY_VARIANTS.find((v) => v.id === r.shot.copy)!;
          body =
            `<div class="miss copia" style="aspect-ratio:${r.shot.width}/${r.shot.height}">Cópia descartável` +
            ` (passo 6): ${richText(variant.change)}.<br><code>${escapeHtml(copyCommand(variant.id))}</code>` +
            `${variant.video ? `<br>Mais: ${richText(variant.video)}.` : ''}</div>`;
        } else {
          body = `<div class="miss ${r.status}" style="aspect-ratio:${r.shot.width}/${r.shot.height}">${escapeHtml(r.detail ?? r.status)}</div>`;
        }
        return `<figure class="${r.status}">${body}<figcaption>${caption}<span>${escapeHtml(r.shot.file)}</span></figcaption></figure>`;
      })
      .join('\n');
    return (
      `<section id="${set.id}"><h2>${set.number}. ${escapeHtml(set.title)}</h2>` +
      `<p class="q">${escapeHtml(set.question)}</p><div class="grid g-${set.id}">\n${figures}\n</div></section>`
    );
  }).join('\n');
  const ok = sheet.results.filter((r) => r.status === 'ok').length;
  const pending = sheet.results.filter((r) => r.status === 'pendente').length;
  const copies = sheet.results.filter((r) => r.status === 'copia').length;
  const problems = sheet.problems.length
    ? `<ul class="problems">${sheet.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
    : '<p class="okline">Sem problemas na rodada.</p>';
  const fakeNote = sheet.fake
    ? '<p class="fake">Rodada contra a PÁGINA FALSA do script (teste do roteiro, não é o jogo).</p>'
    : '';
  const variant = sheet.copy ? COPY_VARIANTS.find((v) => v.id === sheet.copy) : undefined;
  const copyNote = variant
    ? `<p class="fake">Rodada da CÓPIA DESCARTÁVEL <code>${escapeHtml(variant.id)}</code>: ${richText(variant.change)}.</p>`
    : '';
  const tag = sheet.tag ? ` · ${escapeHtml(sheet.tag)}` : '';
  // As perguntas só aparecem com algum conjunto exclusivo da rodada (a leitura é de todas) e nunca na cópia.
  const rounds = sheet.copy ? [] : roundsWithQuestions(sheet.results.map((r) => r.shot));
  const asks = rounds.length > 0;
  const counts = `${ok} de ${sheet.results.length} prints${pending ? ` · ${pending} pendentes` : ''}${copies ? ` · ${copies} na cópia` : ''}`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prints ${escapeHtml(sheet.version)}${tag} · BoboForces</title>
<style>
:root{color-scheme:dark;--bg:#0a0d0b;--chapa:#121815;--linha:#2a352e;--tx:#e8ede6;--tx2:#9da89f;--acao:#f2b233;--perigo:#ef5b4c}
*{box-sizing:border-box}
body{margin:0;padding:24px 16px 48px;background:var(--bg);color:var(--tx);font:15px/1.45 system-ui,sans-serif}
header,section{max-width:1400px;margin:0 auto 32px}
h1{margin:0 0 4px;font-size:22px}h2{margin:0 0 4px;font-size:18px;color:var(--acao)}h3{font-size:16px}
.meta,.q,figcaption span,.ev{color:var(--tx2)}.meta{margin:0;font-size:13px}.q{margin:0 0 12px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}nav a{color:var(--tx);border:1px solid var(--linha);padding:6px 10px;text-decoration:none}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr))}
.g-leitura{grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))}
figure{margin:0;background:var(--chapa);border:1px solid var(--linha);padding:8px}
img{display:block;width:100%;height:auto;image-rendering:pixelated}
figcaption{margin-top:6px;font-size:13px}figcaption span{display:block;font:12px ui-monospace,monospace}
.miss{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px;color:var(--perigo);border:1px dashed var(--perigo);text-align:center}
.miss.pendente,.miss.copia{color:var(--acao);border-color:var(--acao)}
.problems{color:var(--perigo)}.okline{color:#6fcf7a}.fake{color:var(--acao);font-weight:700}
fieldset{border:1px solid var(--linha);background:var(--chapa);margin:0 0 12px;padding:8px 12px}legend{font-weight:700;color:var(--acao)}
.opcoes label{display:block;min-height:32px;padding:4px 0}.ev{font-size:13px}.ev a{color:var(--tx)}
textarea{width:100%;background:var(--bg);color:var(--tx);border:1px solid var(--linha);font:13px ui-monospace,monospace}
button{min-height:44px;padding:8px 16px;background:var(--acao);color:#0a0d0b;border:0;font-weight:700}
code{font:12px ui-monospace,monospace}
</style>
</head>
<body>
<header>
<h1>Prints da cena-vitrine · ${escapeHtml(sheet.version)}${tag}</h1>
<p class="meta">${escapeHtml(sheet.createdAt)} · ${escapeHtml(sheet.browser)} · ${counts} · ${escapeHtml(sheet.url)}</p>
${fakeNote}${copyNote}${problems}
<nav>${asks ? '<a href="#perguntas">Perguntas</a>' : ''}${PRINT_SETS.filter((s) =>
    sheet.results.some((r) => r.shot.set === s.id),
  )
    .map((s) => `<a href="#${s.id}">${s.number}. ${escapeHtml(s.title)}</a>`)
    .join('')}</nav>
</header>
${asks ? questionsHtml(rounds) : ''}
${sections}
</body>
</html>
`;
}
