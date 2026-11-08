// Orçamentos de download da web (tecnico.md §16.4), em bytes TRANSFERIDOS: texto (HTML, JS, CSS, JSON, SVG) estimado
// pelo gzip nível 9 do Node; binários (PNG, MP3, formatos próprios já em deflate) medidos crus. 1 KB = 1000 bytes, como
// no relatório do Vite. O gzip -9 é uma APROXIMAÇÃO: o GitHub Pages serve gzip de outro compressor (cabeçalho XFL = 0,
// sem Brotli; o tamanho bate com o zlib-ng nível 5/6), medido em 03/11/2026 nos 8 textos do site do M0 entre −0,1% e
// +4,8% do zlib -9 (o pior, +4,8%, no JSON das fontes). Os orçamentos com folga larga absorvem isso; o das fontes, que
// é justo, mede o JSON por um limite de cima (`FONT_TEXT_GZIP_LEVEL`).
//
// Grupos (M1): MENU = a carga inicial (HTML + fecho de JS/CSS + o que o index.html pré-carrega: o atlas MSDF);
// PRIMEIRA PARTIDA = o menu + os assets do jogo que a partida no Construto baixa (mapa, modelos, blocos, texturas e
// sons essenciais; as skins do bobo A saem com o porte do boneco, #56), com sub-orçamentos por parte; BUILD INTEIRO =
// tudo. Asset novo sem grupo conta na primeira partida (conservador) até alguém dizer que ele é sob demanda.

export const KB = 1000;
export const MB = 1000 * KB;

export type BudgetId =
  'html' | 'initial' | 'fonts' | 'firstMatch' | 'construto' | 'textures' | 'sounds' | 'total' | 'largest';

export interface Budget {
  readonly id: BudgetId;
  readonly label: string;
  readonly limit: number;
  /** De onde vem o número. */
  readonly source: string;
  /** Parte de outro orçamento (o relatório mostra recuado embaixo dele). */
  readonly parent?: BudgetId;
  /** Meta abaixo do teto: passar dela só avisa (o teto é que reprova). */
  readonly goal?: number;
}

export const BUDGETS: readonly Budget[] = [
  { id: 'html', label: 'HTML + splash inline', limit: 15 * KB, source: 'tecnico.md §16.4 (primeiro pixel < 0,5 s)' },
  {
    id: 'initial',
    label: 'Menu interativo (HTML + JS + atlas MSDF)',
    limit: 350 * KB,
    // Meta do porte do boneco do FutBobo (decisão #56; PLANO do porte §A e risco 16): motor de animação, pintor e
    // tabela de jogo ficam fora do chunk do menu (`MENU_FORBIDDEN_MODULES`), e o menu fica em até 300 KB.
    goal: 300 * KB,
    source: 'tecnico.md §16.4 (menu interativo: core + three + atlas MSDF + texturas de UI); meta do porte (#56)',
  },
  {
    id: 'fonts',
    label: 'Fontes (atlas MSDF: PNG + JSON)',
    parent: 'initial',
    limit: 120 * KB,
    // Leitura do teto como o que o jogador baixa por causa das fontes (PNG cru + JSON em gzip, com o JSON medido pelo
    // limite de cima `FONT_TEXT_GZIP_LEVEL`): decisão menor revisável da rodada das escolhas, registrada em arte-ux §13
    // e tecnico §9/§16.4. Medido em 03/11/2026 com o atlas da decisão #54 (Russo One 22 px + Saira Condensed 20 px,
    // HUD em 7 bits, kerning a partir de 0,25 px): 119.605 B (PNG 111.895 B + JSON 7.710 B em gzip -4), folga de
    // 395 B. Se estourar, a reserva é o HUD em 6 bits (muda o atlas aprovado: precisa de print para o Erick).
    source: 'decisão #54 (fontes até 120 KB; lido como bytes baixados do atlas, calibrado pelo GitHub Pages)',
  },
  {
    id: 'firstMatch',
    label: 'Primeira partida no Construto (acumulado)',
    limit: 1 * MB,
    source: 'tecnico.md §16.4 (primeira partida ≤ 1 MB acumulado)',
  },
  {
    id: 'construto',
    label: 'Construto (mapa, modelos e blocos)',
    parent: 'firstMatch',
    limit: 300 * KB,
    source: 'tecnico.md §16.4 (Construto ≤ 300 KB)',
  },
  {
    id: 'textures',
    // Sem skins desde o porte do boneco (#56): a aparência é pintada no loading, sem asset de runtime (PLANO §B19).
    label: 'Texturas de blocos e modelos',
    parent: 'firstMatch',
    limit: 150 * KB,
    source: 'tecnico.md §16.4 (texturas de blocos e skins ≤ 150 KB)',
  },
  {
    id: 'sounds',
    label: 'Sons essenciais',
    limit: 150 * KB,
    source: 'tecnico.md §16.4 (sons essenciais ≤ 150 KB)',
    parent: 'firstMatch',
  },
  { id: 'total', label: 'Build inteiro', limit: 15 * MB, source: 'tecnico.md §16.4 (jogo completo)' },
  {
    id: 'largest',
    label: 'Maior arquivo',
    limit: 1 * MB,
    // Nenhum arquivo sozinho pode estourar a primeira partida (1 MB acumulado). Música (.mp3) é sob demanda e fica
    // de fora desta conta; ela continua contando no total.
    source: 'tecnico.md §16.4 (primeira partida ≤ 1 MB acumulado)',
  },
];

/** Extensões que ficam de fora do "maior arquivo" (baixadas sob demanda, em segundo plano). */
export const LARGEST_EXCLUDED_EXTENSIONS: readonly string[] = ['.mp3'];

/** O atlas de fontes da UI no dist (`fonts/ui-fonts.{png,json}`, preload do menu): o sub-orçamento "Fontes". */
export const UI_FONT_FILES = /^assets\/fonts\/ui-fonts\.(?:png|json)$/;

/**
 * Nível do gzip do Node que mede o TEXTO do atlas de fontes (o JSON): limite de cima do que o GitHub Pages serve. Nos
 * 8 textos do site do M0 o nível 4 deu sempre mais que o servido (no JSON das fontes: 7.308 B contra 6.951 B servidos
 * e 6.635 B do nível 9). Vale também no menu, onde o mesmo arquivo conta. O fontbake usa o mesmo nível.
 */
export const FONT_TEXT_GZIP_LEVEL = 4;

/** Sub-grupos da primeira partida, por caminho no dist (o primeiro que casar vence). */
export type MatchGroupId = 'construto' | 'textures' | 'sounds';

export const MATCH_GROUPS: readonly { readonly id: MatchGroupId; readonly test: RegExp }[] = [
  // O mapa, o pacote de modelos (`.bfmodel`) e as definições de bloco.
  { id: 'construto', test: /^assets\/(?:maps\/construto\.bfmap|blocks\/|models\/[^/]+\.bfmodel$)/ },
  // As tiras dos texture arrays (`blocos16`; `modelos64`: materiais e modelos). As skins saíram (#56).
  { id: 'textures', test: /^assets\/(?:textures|models)\// },
  { id: 'sounds', test: /^assets\/audio\// },
];

/**
 * Assets APOSENTADOS pelo porte do boneco do FutBobo (decisão #56; PLANO do porte §B18 e §B19): as partes de skin do
 * bobo A (`skins/partes64.*`) e a tira dos rostos (`skins/modelos64-rostos.*`, camadas `faces`/`faces_zombie`). O
 * passo 5 tirou os dois do `runtime-assets.json`. Se voltarem ao build, contam na primeira partida e no build inteiro,
 * FORA do sub-orçamento de texturas, e o relatório avisa (e reprova, com `RETIRED_ASSETS_FAIL`).
 */
export const RETIRED_ASSETS: readonly RegExp[] = [/^assets\/skins\/partes64\./, /^assets\/skins\/modelos64-rostos\./];

/**
 * Com `true`, asset aposentado no build REPROVA (portão do passo 5: "texturas sem `partes64` e rostos"). Ligado no
 * passo 5, depois de os arquivos saírem; `--sem-aposentados` continua ligando na linha de comando.
 */
export const RETIRED_ASSETS_FAIL = true;

/**
 * Módulos que NÃO podem entrar na carga inicial (o chunk do menu): o motor de animação, o pintor e a tabela de jogo
 * do boneco (PLANO do porte §B19 e risco 16; só a partida usa). Casam com as fontes dos sourcemaps (caminho com `/`).
 */
export const MENU_FORBIDDEN_MODULES: readonly { readonly label: string; readonly test: RegExp }[] = [
  { label: 'motor de animação dos bonecos (render/src/actors/anim)', test: /packages\/render\/src\/actors\/anim\// },
  {
    label: 'pintor da skin do boneco (format figure-paint*)',
    test: /packages\/format\/src\/model\/figure-paint[^/]*$/,
  },
  { label: 'tabela de jogo do boneco (format figure-table)', test: /packages\/format\/src\/model\/figure-table\.ts$/ },
];

/**
 * Código JS/CSS fora do fecho inicial que NÃO entra na primeira partida (integração do M1): a casca do bench
 * (`?bench`, `src/bench/shell.ts`) e o `net` (M5). O resto do código preguiçoso — o chunk da cena (`src/scene.ts`:
 * mundo, IA, renderer completo) e os que ele divide — conta na primeira partida.
 */
export const ON_DEMAND_CODE: readonly RegExp[] = [/^assets\/shell-[^/]+\.js$/, /^assets\/net-[^/]+\.js$/];

/**
 * Assets do jogo baixados SÓ sob demanda (fora da primeira partida; contam no build inteiro): os sons do teste de
 * áudio do Teste Zero (`t0-*`, tela de teste do Switch), música (M2) e os outros mapas.
 */
export const ON_DEMAND_ASSETS: readonly RegExp[] = [
  /^assets\/audio\/t0-/,
  /^assets\/music\//,
  /^assets\/maps\/(?!construto\.bfmap$)/,
];
