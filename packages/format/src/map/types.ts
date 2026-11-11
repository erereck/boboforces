import type { PlatformProfileId } from '../platform-profiles.ts';

/**
 * `map@1` (`.bfmap`): o mapa compilado pelo `tools/mapc` (tecnico.md §15.2, GDD §4.6.3). CONTRATO DO M1;
 * codificador, decodificador e validador são da frente "mapa-nav" (`map/codec.ts`, `map/validate.ts`).
 *
 * Unidades: grade em células de 0,5 m a partir de (0, 0, 0); props em TEXELS do cenário (1/32 m, inteiros); marcadores
 * em metros (f32) e radianos (convenção do shared: yaw 0 olha para -Z, yaw + vira à esquerda, pitch + para cima).
 * IDs de conteúdo vão SEM prefixo (`barrel` = `model:barrel`; `concrete` = `block:concrete`).
 *
 * O formato não depende do `world` (o `world` importa o `format`): a grade vai como `MapGrid`, que tem a mesma forma
 * do `ChunkData` do world; `gridFromMapGrid`/`mapGridFromGrid` (no world) convertem.
 */
export const MAP_FORMAT = 'boboforces/map@1';
/** Bytes 0..3 do arquivo DEPOIS do inflate: "BFMP" em little-endian. */
export const BFMAP_MAGIC = 0x504d4642;
export const BFMAP_VERSION = 1;
/** Versão 0 = arquivo PROVISÓRIO gravado pela etapa de contratos; o decodificador recusa com "rode npm run mapc". */
export const BFMAP_PLACEHOLDER_VERSION = 0;

/** Tamanho da célula gravado no cabeçalho (decisão #6). Outro valor é recusado. */
export const MAP_CELL_SIZE_M = 0.5;
/** Texels do cenário por metro (posição das props). */
export const MAP_TEXELS_PER_METER = 32;

export interface MapDocument {
  readonly format: typeof MAP_FORMAT;
  /** ID local do mapa (`construto` = `map:construto`). */
  readonly id: string;
  readonly meta: MapMeta;
  /**
   * Tabela de blocos usados: posição i (1..) → ID estável do bloco sem prefixo. A posição 0 é sempre `air`. As células
   * da grade guardam esse índice LOCAL (10 bits); no loading o jogo monta o `BlockRegistry` nesta mesma ordem
   * (`createMapBlockRegistry` do world), e bloco desconhecido cai em `missing` (fallback de conteúdo).
   */
  readonly blocks: readonly string[];
  readonly grid: MapGrid;
  readonly props: readonly MapProp[];
  readonly markers: MapMarkers;
  readonly light: MapLight;
}

export interface MapMeta {
  /** Chave da tabela de textos (`map.construto.name`); o nome exibido nunca vai no arquivo (só pt-BR na tabela). */
  readonly nameKey: string;
  /** Modos suportados, IDs sem prefixo (`warfare.tdm`). */
  readonly modes: readonly string[];
  readonly players: { readonly min: number; readonly ideal: number; readonly max: number };
  /** Maior linha de visão declarada, em metros (o `mapc` mede e confere). */
  readonly maxSightLineM: number;
  /** Teto de bots por perfil de plataforma (abaixo do teto do perfil; ausente = o do perfil). */
  readonly botCaps: Readonly<Partial<Record<PlatformProfileId, number>>>;
}

/** Grade estática: mesmo desenho do `ChunkData` do world (x mais rápido, depois z, depois y). */
export interface MapGrid {
  /** Em células. */
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  /** Só os chunks com algum bloco; ausentes são ar. Sem repetição de (cx, cy, cz). */
  readonly chunks: readonly MapChunk[];
}

export interface MapChunk {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  /** Célula u16 de todas as posições quando `cells` é `null` (chunk uniforme). */
  readonly uniform: number;
  /** 32.768 células (`lx | lz << 5 | ly << 10`) ou `null`. No arquivo: corridas RLE de u16. */
  readonly cells: Uint16Array | null;
}

/**
 * Dose de props: marca de AUTORIA de cada prop (as 3 doses do print 3). A dose do jogo é `PLAYABLE_PROP_DOSE`
 * (decisão #52: o dobro); a marca fica no arquivo para o A/B de custo e para refazer o print.
 */
export const PROP_DOSE = {
  /** Aparece em todas as doses (até no "só blocos"): props estruturais raras. */
  always: 0,
  /** A dose proposta do print 3. */
  proposal: 1,
  /** Só no "dobro" do print 3 (que virou a dose do jogo, #52). */
  double: 2,
} as const;
export type PropDose = (typeof PROP_DOSE)[keyof typeof PROP_DOSE];

/**
 * Dose do JOGO (decisão #52: dobro jogável). Colisão, bala, visão dos bots, navegação e luz usam as props com dose ≤
 * esta, no `mapc` e no loading. Nunca varia por plataforma: colisão diferente quebraria golden, replays e justiça.
 */
export const PLAYABLE_PROP_DOSE: PropDose = PROP_DOSE.double;

/** A prop faz parte do jogo (colide, para bala, tapa visão, entra na navegação e acende luz)? */
export function isPlayableProp(prop: Pick<MapProp, 'dose'>): boolean {
  return prop.dose <= PLAYABLE_PROP_DOSE;
}

/**
 * Qual dose o render mostra (chave `propDose` da depuração): `blocks` = só as `always`; `proposal` = `always` +
 * `proposal`; `double` = todas. Chave SÓ VISUAL de depuração: abaixo da dose do jogo (`PLAYABLE_PROP_DOSE_VIEW`) o
 * render esconde props que continuam colidindo, então não serve para print de jogo; serve para o A/B de custo das props
 * no bench. A colisão nunca segue esta chave.
 */
export type PropDoseView = 'blocks' | 'proposal' | 'double';

/** A vista do render que mostra exatamente as props do jogo (`PLAYABLE_PROP_DOSE`); padrão da depuração. */
export const PLAYABLE_PROP_DOSE_VIEW: PropDoseView = 'double';

export interface MapProp {
  /** ID do modelo sem prefixo (`barrel` = `model:barrel`). */
  readonly model: string;
  /** Posição do PIVÔ do modelo em texels do cenário (1/32 m), inteiros. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Giro em Y em passos de 1/256 de volta (0..255), anti-horário visto de cima como o yaw. */
  readonly yaw: number;
  /** Escala uniforme em 1/16 (16 = 1,0; 1..255). O pixel continua quadrado. */
  readonly scale: number;
  readonly dose: PropDose;
}

/** Ponto de nascimento (pés), em metros e radianos. `team` = -1 vale para qualquer time (FFA). */
export interface MapSpawnMarker {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly team: number;
}

/** Ponto de Domination (M6+, já marcado no Construto): letra, centro dos pés e raio em metros. */
export interface MapPointMarker {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * Câmera NOMEADA (prints, bench, Aquário). Posição do olho em metros, yaw/pitch em radianos, FOV vertical em graus
 * (`fovYDeg` 0 = o padrão do jogo).
 */
export interface MapCamera {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly fovYDeg: number;
}

/** Ponto de rota de câmera: posição, olhar e o instante (s desde o começo da rota, crescente). */
export interface MapRoutePoint {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

/** Rota de câmera do bench (interpolação Catmull-Rom na posição e menor arco no yaw). */
export interface MapCameraRoute {
  readonly name: string;
  readonly loop: boolean;
  readonly points: readonly MapRoutePoint[];
}

/**
 * Manequim: bobo parado para prints e para a cena-vitrine (não é entidade da sim). `look` é o ID de skin pronta sem
 * prefixo (`recruit` = `skin:recruit`), `team` -1 = sem colete de time, `pose` uma das poses de print (`slide` = o
 * deslize "carrinho" do boneco do FutBobo, só da régua `altura:deslizando`; PLANO do porte §B16). No `.bfmap` a pose
 * vai como texto no JSON da seção MARK: acrescentar um valor não muda os bytes de um mapa que não o usa.
 */
export interface MapMannequin {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly look: string;
  readonly team: number;
  readonly zombie: boolean;
  readonly pose: 'stand' | 'crouch' | 'aim' | 'slide';
  /** Modelo de arma na mão (ID sem prefixo) ou '' sem arma. */
  readonly weapon: string;
}

/**
 * M3 (fase 3d): janela com barricada do Bobo Zombies (vão no chão; o `SimMap.barricades` da sim): centro nos pés em
 * metros, lado de fora (de onde os zumbis vêm: 0 +X, 1 -X, 2 +Z, 3 -Z), largura e altura do vão.
 */
export interface MapBarricadeMarker {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly outside: 0 | 1 | 2 | 3;
  readonly width: number;
  readonly height: number;
}

/** M3 (fase 3d): porta paga (ou escombro) do Bobo Zombies: a caixa que fecha a passagem (metros) e o preço. */
export interface MapPaidDoorMarker {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly cost: number;
}

/**
 * M3 (fase 4a): arma na parede do Bobo Zombies: um ponto na face da parede, na altura do chão (metros; o desenho fica
 * 1,3 m acima), o lado para onde a parede olha (onde fica quem compra) (0 +X, 1 -X, 2 +Z, 3 -Z), a arma (ID sem prefixo, `weapon:<id>` do
 * registro) e o preço.
 */
export interface MapWallBuyMarker {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: 0 | 1 | 2 | 3;
  readonly weapon: string;
  readonly cost: number;
}

/** M3 (fase 4b): posição da Caixa Misteriosa: centro do pé da caixa (metros) e o lado da frente (0 +X, 1 -X, 2 +Z, 3 -Z). */
export interface MapBoxSpotMarker {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: 0 | 1 | 2 | 3;
}

/**
 * M3 (fase 4c): máquina de vantagem do Bobo Zombies: o meio da frente, no chão (metros), o lado da frente (0 +X, 1 -X,
 * 2 +Z, 3 -Z), a vantagem (`chonky`, `speedy` ou `buddy`) e o preço.
 */
export interface MapPerkMachineMarker {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: 0 | 1 | 2 | 3;
  readonly perk: string;
  readonly cost: number;
}

export interface MapMarkers {
  readonly spawns: readonly MapSpawnMarker[];
  readonly domination: readonly MapPointMarker[];
  readonly cameras: readonly MapCamera[];
  readonly routes: readonly MapCameraRoute[];
  readonly mannequins: readonly MapMannequin[];
  /**
   * M3 (fase 3d): janelas com barricada e portas pagas (Bobo Zombies). Opcionais no JSON da seção MARK: um mapa sem
   * nenhuma tem os mesmos bytes de antes.
   */
  readonly barricades?: readonly MapBarricadeMarker[];
  readonly paidDoors?: readonly MapPaidDoorMarker[];
  /** M3 (fase 4a): armas na parede (opcional, como as janelas). */
  readonly wallBuys?: readonly MapWallBuyMarker[];
  /** M3 (fase 4b): posições da Caixa Misteriosa (até 3; a 1ª é onde ela começa). */
  readonly boxSpots?: readonly MapBoxSpotMarker[];
  /** M3 (fase 4c): máquinas de vantagem (opcional). */
  readonly perkMachines?: readonly MapPerkMachineMarker[];
  /** Área jogável (metros): fora dela, em X/Z, é parede invisível; abaixo de `killPlaneY` morre. */
  readonly playArea: {
    readonly minX: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxZ: number;
    readonly killPlaneY: number;
  };
}

/** Preset de hora do dia (uniforms do render; `TIME_OF_DAY_PRESETS` no render/data). */
export type TimeOfDay = 'day' | 'dusk' | 'night';
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['day', 'dusk', 'night'];

/** Fonte de luz de prop emissiva: célula e nível (entra no flood fill do emissivo, `LightEmitter` do world). */
export interface MapLightEmitter {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly level: number;
}

export interface MapLight {
  /** Direção PARA o sol, unitária, com y > 0. Fixa por mapa (a sombra do cenário é calculada com ela). */
  readonly sunDir: readonly [x: number, y: number, z: number];
  /** Hora do dia padrão do mapa. */
  readonly timeOfDay: TimeOfDay;
  /** Fontes das props emissivas (o `mapc` gera a partir de `model.light`). */
  readonly emitters: readonly MapLightEmitter[];
}

// --- Nomes fixos de câmeras e rotas (prints do M1 e bench) ---

/**
 * Câmeras que o Construto PRECISA ter (o validador do `mapc` reprova sem elas). Usadas pelo `scripts/prints.ts` pelo
 * gancho de depuração (`GameDebugApi.setCamera`):
 * - `print:dia`: a câmera fixa dos prints 1 (Dia, Entardecer, Noite);
 * - `print:densidade-1m` / `print:densidade-3m`: bobo e parede a 1 m e a 3 m (print 2);
 * - `print:doses`: a vista das 3 doses de props (print 3; fica para o A/B de custo, #52);
 * - `print:leitura-5m`…`print:leitura-50m`: manequins a 5, 15, 30 e 50 m numa vista de 640×360 (print 4);
 * - `print:mip`: chão ao longe, para o filtro de mipmap (print 5);
 * - `print:altura`: a régua de métricas de perfil (decisão #53), fora da área jogável: batente de porta de 2,0 m, muro
 *   de 1,5 m, cobertura de 1,0 m com o manequim agachado atrás e o manequim em pé ao lado da porta;
 * - `print:setores-norte` / `print:setores-sul` / `print:setores-4-5`: números de setor no chão, na altura do olho
 *   (print 9): um número visto do sul e outro visto do norte (girado 180°), para conferir que o 6 e o 9 não se
 *   confundem, e dois setores vizinhos lado a lado.
 */
export const PRINT_CAMERAS = [
  'print:dia',
  'print:densidade-1m',
  'print:densidade-3m',
  'print:doses',
  'print:leitura-5m',
  'print:leitura-15m',
  'print:leitura-30m',
  'print:leitura-50m',
  'print:mip',
  'print:altura',
  'print:setores-norte',
  'print:setores-sul',
  'print:setores-4-5',
] as const;
export type PrintCameraName = (typeof PRINT_CAMERAS)[number];

/**
 * Câmeras OPCIONAIS dos prints do boneco do FutBobo (PLANO do porte §B16; fora dos obrigatórios, o validador não as
 * exige): a fila `linha:1..8` de frente, a 3/4, de costas e nas expressões, o close a 1 m (`close:1` e `close:5`) e a
 * régua a 45° (`print:altura-45`, decisão 6 da §I do PLANO): os mesmos `altura:*` da `print:altura`, com a mesma
 * altura, o mesmo FOV e pitch 0 (o topo da cobertura de 1,0 m continua no horizonte), girada 45° no yaw.
 */
export const OPTIONAL_PRINT_CAMERAS = [
  'print:linha-frente',
  'print:linha-3-4',
  'print:linha-costas',
  'print:linha-expressoes',
  'print:close-1m',
  'print:altura-45',
] as const;
export type OptionalPrintCameraName = (typeof OPTIONAL_PRINT_CAMERAS)[number];

/**
 * Rotas do bench: `bench:volta` (obrigatória) dá a volta na área jogável na altura do olho, em laço de 60 s, passando
 * pelo galpão e pelas linhas de visão longas; `bench:alto` (opcional) é a vista de cima da torre, o pior caso de
 * regiões visíveis.
 */
export const BENCH_ROUTES = ['bench:volta', 'bench:alto'] as const;
export const REQUIRED_BENCH_ROUTES = ['bench:volta'] as const;
export type BenchRouteName = (typeof BENCH_ROUTES)[number];

/**
 * Manequins com nome fixo usados pelos prints (o `mapc` reprova sem eles): os 6 da cena-vitrine (`vitrine:1..6`: 3 skins
 * prontas, 2 com colete de time A e B, 1 zumbi) e o PAR do print de leitura (`leitura:a` do time A e `leitura:b` do
 * time B, lado a lado; as 4 câmeras `print:leitura-*` olham o mesmo par de 5, 15, 30 e 50 m — verificação do M1: com
 * um par por distância na mesma visada, o de 5 m tapava os outros) e o PAR da régua de métricas (`altura:em-pe` ao
 * lado da porta e `altura:agachado` atrás da cobertura de 1,0 m, decisão #53). Os `leitura:*`, os `altura:*` e o
 * `densidade` são só de print: o `game` só os desenha com uma câmera `print:leitura-*`, `print:altura` ou
 * `print:densidade-*` ativa.
 */
export const REQUIRED_MANNEQUINS = [
  'vitrine:1',
  'vitrine:2',
  'vitrine:3',
  'vitrine:4',
  'vitrine:5',
  'vitrine:6',
  'leitura:a',
  'leitura:b',
  'altura:em-pe',
  'altura:agachado',
] as const;

/**
 * Manequins OPCIONAIS do boneco do FutBobo (PLANO do porte §B16; fora de `REQUIRED_MANNEQUINS`): a fila `linha:1..8`
 * (x = 74,5; z = 32,2 + (n − 4,5)·0,95, olhando para −X), o close `close:1` e `close:5` e a régua
 * `altura:deslizando` (pose `slide`, ao lado de `altura:em-pe` e `altura:agachado`).
 */
export const OPTIONAL_MANNEQUINS = [
  'linha:1',
  'linha:2',
  'linha:3',
  'linha:4',
  'linha:5',
  'linha:6',
  'linha:7',
  'linha:8',
  'close:1',
  'close:5',
  'altura:deslizando',
] as const;
export type OptionalMannequinName = (typeof OPTIONAL_MANNEQUINS)[number];

/**
 * Grupos de manequins (o `game` decide pelo nome): a vitrine (`always`, sempre desenhada) e os de print, só com a
 * câmera nomeada deles: `reading` = `leitura:*` com `print:leitura-*`; `density` = `densidade` com `print:densidade-*`;
 * `height` = `altura:*` com `print:altura` e `print:altura-45`; `line` = a fila `linha:*` e o close `close:*` com
 * `print:linha-*` e `print:close-1m` (as skins da fila só são compostas quando o loading recebe o pedido de prints).
 */
export const MANNEQUIN_KIND = { always: 0, reading: 1, density: 2, height: 3, line: 4 } as const;
export type MannequinKind = (typeof MANNEQUIN_KIND)[keyof typeof MANNEQUIN_KIND];
