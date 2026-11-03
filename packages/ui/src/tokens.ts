/**
 * Tokens da UI (decisão #22; arte-ux.md §6.2; fonte da verdade: `.interface-design/system.md`). "Painel de comando de
 * um quartel de brinquedo": o mundo é colorido, a interface é escura e contida. Cores em 0xRRGGBBAA (o formato de
 * `DrawList.colors`). Medidas em px de REFERÊNCIA (1280×720); o layout multiplica pela escala. Mudar aqui muda em todo
 * lugar; mudar a direção exige atualizar o system.md junto.
 */

/** 0xRRGGBB + alfa (0..1) → 0xRRGGBBAA. */
export function rgba(rgb: number, alpha = 1): number {
  return (((rgb & 0xffffff) << 8) | Math.round(Math.min(1, Math.max(0, alpha)) * 255)) >>> 0;
}

/** Troca o alfa de uma cor 0xRRGGBBAA (0..1). */
export function withAlpha(color: number, alpha: number): number {
  return rgba(color >>> 8, alpha);
}

export const COLORS = {
  /** Fundo das telas (nível 0). */
  bunker: rgba(0x0a0d0b),
  /** Cards, painéis e botão secundário (nível 1). */
  chapa: rgba(0x121815),
  /** Elementos elevados, item com foco (nível 2). */
  chapaAlta: rgba(0x1a221d),
  /** Modais e popovers (nível 3). */
  chapaTopo: rgba(0x222c25),
  /** Bordas de 1 px e divisórias. */
  linha: rgba(0x2a352e),
  /** Borda enfatizada (botão secundário, campo). */
  linhaForte: rgba(0x3b4a40),
  texto: rgba(0xe8ede6),
  textoBaixo: rgba(0x9da89f),
  /** Texto sobre a cor de ação (âmbar): quase preto, levemente quente. */
  textoSobreAcao: rgba(0x14110a),
  /** Botão primário, foco, seleção. É a única cor "de chamar atenção" fora de perigo. */
  acao: rgba(0xf2b233),
  /** Ação pressionada/ativa. */
  acaoForte: rgba(0xd99a1e),
  /** Vida baixa, avisos, sair. */
  perigo: rgba(0xef5b4c),
  /** Confirmação, pronto. */
  ok: rgba(0x6fcf7a),
  /** Fundo das plaquinhas do HUD (bunker a 70%). */
  hudFundo: rgba(0x0a0d0b, 0.7),
  /** Véu atrás de modais e da pausa. */
  veu: rgba(0x050706, 0.72),
} as const;

/** Times A–D (sempre com ícone: ▲ ● ■ ◆). Laranja × azul é o par mais seguro para daltonismo vermelho-verde. */
export const TEAM_COLORS: readonly number[] = [rgba(0xff7a1a), rgba(0x2e8bff), rgba(0x3ddc97), rgba(0xa66bff)];

/** Jogadores locais P1–P4. */
export const PLAYER_COLORS: readonly number[] = [rgba(0xffd23f), rgba(0x3fe0ff), rgba(0xff6fb5), rgba(0xb8f03c)];

/** Escala da UI (tecnico.md §9): referência 1280×720, escalada por min(w/1280, h/720) × tamanho escolhido. */
export const UI_REFERENCE = { width: 1280, height: 720 } as const;
/** HUD: referência por viewport (um quadrante de 4 jogadores em 1280×720). */
export const HUD_REFERENCE = { width: 640, height: 360 } as const;

/** Espaçamento em px de referência (unidade 4, como no futbobo). */
export const SPACING = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

/** Alvo mínimo de toque (convenção EriLab, em px de layout) e margem dos gestos do sistema no celular. */
export const MIN_TOUCH_TARGET = 44;
export const TOUCH_EDGE_MARGIN = 24;

/**
 * Pisos de texto em px reais depois da escala (arte-ux.md §6.8). O `game` escolhe o piso pelo contexto e passa em
 * `LayoutOptions.minTextPx`; no celular, multiplica o valor em px de layout pelo pixelRatio.
 */
export const MIN_TEXT = { phone: 13, tv: 22, switchSplit: 16, switchHandheld: 18 } as const;

/** Assinatura: chanfro de 45° no canto superior direito de cards e botões (px de referência). */
export const CHAMFER = { card: 12, button: 14 } as const;

/** Margem da tela (px de referência) somada à safe area; na TV ela cobre os 5% de segurança em 1280×720. */
export const SCREEN_MARGIN = { x: 64, y: 40 } as const;

/** Movimento: entradas curtas e secas (120 a 180 ms, ease-out, 8 px). */
export const MOTION = { enterMs: 150, slidePx: 8 } as const;

/** Papel da fonte MSDF: títulos e botões (display pesada) ou leitura/números do HUD (condensada). */
export type FontRole = 'display' | 'hud';

export interface TypeStyle {
  readonly font: FontRole;
  /** Tamanho da fonte (em) em px de referência. */
  readonly size: number;
  /** Espaçamento entre letras, em em. */
  readonly tracking: number;
  readonly uppercase: boolean;
}

/**
 * Escala tipográfica (px de referência). O piso de 22 vem da TV/Switch na dock em 720p (arte-ux.md §6.8). Hierarquia
 * por peso e cor antes de tamanho; rótulos de seção em caixa alta condensada com espaçamento largo.
 */
export const TYPE = {
  logo: { font: 'display', size: 136, tracking: 0.01, uppercase: true },
  title: { font: 'display', size: 64, tracking: 0.02, uppercase: true },
  heading: { font: 'display', size: 40, tracking: 0.02, uppercase: true },
  button: { font: 'display', size: 30, tracking: 0.06, uppercase: true },
  body: { font: 'hud', size: 26, tracking: 0, uppercase: false },
  label: { font: 'hud', size: 22, tracking: 0.14, uppercase: true },
  caption: { font: 'hud', size: 22, tracking: 0.02, uppercase: false },
  number: { font: 'display', size: 44, tracking: 0, uppercase: false },
} as const satisfies Readonly<Record<string, TypeStyle>>;

export type TypeToken = keyof typeof TYPE;

/** Botão: medidas em px de referência. O layout aplica `minTarget` por cima da altura. */
export const BUTTON = {
  height: 60,
  minWidth: 240,
  padX: 28,
  /** Contorno do foco: espessura e distância da borda do botão. */
  focusStroke: 3,
  focusGap: 4,
  /** Borda do secundário. */
  stroke: 2,
} as const;

export function uiScale(width: number, height: number, userScale = 1): number {
  return Math.min(width / UI_REFERENCE.width, height / UI_REFERENCE.height) * userScale;
}
