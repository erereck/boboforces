import { DEFAULT_TOUCH_LAYOUT, placeTouchButton, type InputMapper, type TouchButtonRect } from '@boboforces/input';
import type { SafeAreaInsets } from '@boboforces/platform-api';
import {
  COLORS,
  drawText,
  formatInt,
  measureText,
  pushRect,
  pushShape,
  SCREEN_MARGIN,
  t,
  TYPE,
  withAlpha,
  type DrawList,
  type MsdfFont,
  type StringKey,
  type TypeStyle,
  type UiFonts,
} from '@boboforces/ui';

/** O que o HUD mostra neste frame (o `game` preenche a partir da SimView; sem alocar). */
export interface HudState {
  health: number;
  maxHealth: number;
  kills: number;
  clip: number;
  reserve: number;
  dead: boolean;
  /** 1 no acerto, cai até 0 (a retícula acende). */
  hitMarker: number;
  /** Mostrar "Clique para mirar com o mouse" (teclado/mouse sem pointer lock). */
  clickToAim: boolean;
  /** Mapeador de toque para desenhar joystick e botões; `null` fora do toque. */
  touch: InputMapper | null;
}

export function createHudState(): HudState {
  return {
    health: 0,
    maxHealth: 100,
    kills: 0,
    clip: 0,
    reserve: 0,
    dead: false,
    hitMarker: 0,
    clickToAim: false,
    touch: null,
  };
}

/** Área do HUD (uma viewport) e escala. */
export interface HudFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** min(vw/1280, vh/720) (arte-ux.md §6.6). */
  readonly scale: number;
  /** Piso do texto em px reais (arte-ux.md §6.8). */
  readonly minTextPx: number;
  readonly safeArea: SafeAreaInsets;
  readonly pixelRatio: number;
}

export interface Hud {
  draw(out: DrawList, fonts: UiFonts | null, frame: HudFrame, state: Readonly<HudState>): void;
}

/** Texto que só é refeito quando o número muda (o HUD roda todo frame: sem string nova por frame, regra 11). */
interface CachedNumber {
  value: number;
  text: string;
}

function cachedInt(c: CachedNumber, value: number): string {
  if (value !== c.value) {
    c.value = value;
    c.text = formatInt(value);
  }
  return c.text;
}

const TOUCH_LABELS: Readonly<Record<string, StringKey>> = {
  fire: 'touch.fire',
  ads: 'touch.ads',
  jump: 'touch.jump',
  crouch: 'touch.crouch',
  reload: 'touch.reload',
  grenade: 'touch.grenade',
  weapon: 'touch.weapon',
  pause: 'touch.pause',
};

/**
 * HUD mínimo do M0 (arte-ux.md §6.7): vida embaixo à esquerda (número + barra), munição embaixo à direita, abates no
 * topo ao centro, retícula que acende no acerto, "Renascendo…" morto, dica do pointer lock e os controles de toque.
 * Plaquinhas no fundo `hudFundo`; texto MSDF (sem fontes, só as formas aparecem).
 */
export function createHud(): Hud {
  const healthLabel = t('hud.health').toUpperCase();
  const killsLabel = t('hud.kills').toUpperCase();
  const respawning = t('hud.respawning');
  const clickToAim = t('hud.clickToAim');
  const sceneTitle = t('test.sceneTitle').toUpperCase();
  const touchLabels = new Map<string, string>();
  for (const [control, key] of Object.entries(TOUCH_LABELS)) touchLabels.set(control, t(key).toUpperCase());
  const health: CachedNumber = { value: Number.NaN, text: '' };
  const kills: CachedNumber = { value: Number.NaN, text: '' };
  const ammo = { clip: Number.NaN, reserve: Number.NaN, text: '' };
  const touchRect: TouchButtonRect = { control: 'fire', x: 0, y: 0, radius: 0 };

  function px(style: TypeStyle, scale: number, min: number): number {
    return Math.max(style.size * scale, min);
  }

  function text(
    out: DrawList,
    font: MsdfFont | undefined,
    value: string,
    x: number,
    capTop: number,
    size: number,
    color: number,
    tracking: number,
    align: 'left' | 'center' | 'right' = 'left',
  ): number {
    if (!font) return 0;
    const w = align === 'left' ? 0 : measureText(font, value, size, tracking);
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    return drawText(out, font, value, left, capTop, size, color, tracking);
  }

  function capHeight(font: MsdfFont | undefined, size: number): number {
    return font ? (font.capHeight * size) / font.size : size * 0.7;
  }

  function drawCrosshair(out: DrawList, cx: number, cy: number, s: number, lit: number, dead: boolean): void {
    if (dead) return;
    const thick = Math.max(2, Math.round(2 * s));
    const len = Math.max(5, Math.round(9 * s));
    const gap = Math.max(4, Math.round(6 * s));
    const color = lit > 0 ? COLORS.acao : withAlpha(COLORS.texto, 0.92);
    const shadow = withAlpha(COLORS.bunker, 0.6);
    const x = Math.round(cx);
    const y = Math.round(cy);
    const h = Math.floor(thick / 2);
    // Sombra de 1 px por baixo: a retícula aparece sobre o céu claro e sobre o piso.
    pushRect(out, x - gap - len - 1, y - h - 1, len + 2, thick + 2, shadow);
    pushRect(out, x + gap - 1, y - h - 1, len + 2, thick + 2, shadow);
    pushRect(out, x - h - 1, y - gap - len - 1, thick + 2, len + 2, shadow);
    pushRect(out, x - h - 1, y + gap - 1, thick + 2, len + 2, shadow);
    pushRect(out, x - gap - len, y - h, len, thick, color);
    pushRect(out, x + gap, y - h, len, thick, color);
    pushRect(out, x - h, y - gap - len, thick, len, color);
    pushRect(out, x - h, y + gap, thick, len, color);
  }

  function drawTouch(out: DrawList, fonts: UiFonts | null, f: HudFrame, mapper: InputMapper): void {
    const layout = mapper.profile.touch ?? DEFAULT_TOUCH_LAYOUT;
    const font = fonts?.hud;
    const labelPx = Math.max(13 * f.pixelRatio, f.minTextPx * 0.75);
    for (let i = 0; i < layout.buttons.length; i++) {
      const b = placeTouchButton(layout, i, f.width, f.height, f.pixelRatio, touchRect);
      const down = mapper.isTouchControlDown(b.control);
      const size = b.radius * 2;
      const x = f.x + b.x - b.radius;
      const y = f.y + b.y - b.radius;
      pushShape(out, x, y, size, size, down ? withAlpha(COLORS.acao, 0.55) : COLORS.hudFundo, 0);
      pushShape(out, x, y, size, size, withAlpha(COLORS.texto, 0.5), 0, Math.max(1, Math.round(f.pixelRatio)));
      const label = touchLabels.get(b.control) ?? '';
      const capH = capHeight(font, labelPx);
      text(out, font, label, f.x + b.x, f.y + b.y - capH / 2, labelPx, COLORS.texto, 0.04, 'center');
    }
    const js = mapper.touchJoystick;
    if (js.active) {
      const r = layout.joystickRadius * f.pixelRatio;
      pushShape(out, f.x + js.baseX - r, f.y + js.baseY - r, r * 2, r * 2, withAlpha(COLORS.texto, 0.4), 0, 2);
      const k = r * 0.45;
      pushShape(out, f.x + js.knobX - k, f.y + js.knobY - k, k * 2, k * 2, withAlpha(COLORS.texto, 0.6), 0);
    }
  }

  return {
    draw(out, fonts, f, s): void {
      const sc = f.scale;
      const display = fonts?.display;
      const hud = fonts?.hud;
      // Metade da margem dos menus (o HUD fica mais perto da borda), nunca dentro da safe area.
      const left = f.x + Math.max(SCREEN_MARGIN.x * sc * 0.5, f.safeArea.left);
      const right = f.x + f.width - Math.max(SCREEN_MARGIN.x * sc * 0.5, f.safeArea.right);
      const top = f.y + Math.max(SCREEN_MARGIN.y * sc * 0.5, f.safeArea.top);
      const bottom = f.y + f.height - Math.max(SCREEN_MARGIN.y * sc * 0.5, f.safeArea.bottom);
      const pad = Math.round(12 * sc);
      const labelPx = px(TYPE.label, sc, f.minTextPx);
      const numberPx = px(TYPE.number, sc, f.minTextPx);
      const captionPx = px(TYPE.caption, sc, f.minTextPx);

      // Título da cena (canto superior esquerdo): deixa claro que é a cena de teste do M0.
      text(out, hud, sceneTitle, left, top, labelPx, COLORS.textoBaixo, TYPE.label.tracking);

      // Abates (topo, centro).
      const killsText = cachedInt(kills, s.kills);
      const cx = f.x + f.width / 2;
      const killsW = Math.max(
        hud ? measureText(hud, killsLabel, labelPx, TYPE.label.tracking) : labelPx * 4,
        display ? measureText(display, killsText, numberPx, 0) : numberPx,
      );
      const plateW = killsW + pad * 2;
      const plateH = capHeight(hud, labelPx) + capHeight(display, numberPx) + pad * 3;
      pushShape(out, cx - plateW / 2, top, plateW, plateH, COLORS.hudFundo, Math.round(8 * sc));
      text(out, hud, killsLabel, cx, top + pad, labelPx, COLORS.textoBaixo, TYPE.label.tracking, 'center');
      text(out, display, killsText, cx, top + pad * 2 + capHeight(hud, labelPx), numberPx, COLORS.texto, 0, 'center');

      // Vida (embaixo à esquerda): rótulo, número e barra.
      const hp = Math.max(0, Math.ceil(s.health));
      const hpText = cachedInt(health, hp);
      const frac = s.maxHealth > 0 ? Math.min(1, hp / s.maxHealth) : 0;
      const low = frac <= 0.35;
      const barH = Math.max(3, Math.round(6 * sc));
      const hpW = Math.round(220 * sc);
      const hpH = Math.round(capHeight(hud, labelPx) + capHeight(display, numberPx) + barH + pad * 4);
      const hpY = bottom - hpH;
      pushShape(out, left, hpY, hpW, hpH, COLORS.hudFundo, Math.round(8 * sc));
      text(out, hud, healthLabel, left + pad, hpY + pad, labelPx, COLORS.textoBaixo, TYPE.label.tracking);
      text(
        out,
        display,
        hpText,
        left + pad,
        hpY + pad * 2 + capHeight(hud, labelPx),
        numberPx,
        low ? COLORS.perigo : COLORS.texto,
        0,
      );
      const barY = hpY + hpH - pad - barH;
      pushRect(out, left + pad, barY, hpW - pad * 2, barH, COLORS.linha);
      pushRect(out, left + pad, barY, Math.round((hpW - pad * 2) * frac), barH, low ? COLORS.perigo : COLORS.ok);

      // Munição (embaixo à direita): pente / reserva.
      if (s.clip !== ammo.clip || s.reserve !== ammo.reserve) {
        ammo.clip = s.clip;
        ammo.reserve = s.reserve;
        ammo.text = t('hud.ammo', { clip: s.clip, reserve: s.reserve });
      }
      const ammoW = (display ? measureText(display, ammo.text, numberPx, 0) : numberPx * 3) + pad * 2;
      const ammoH = Math.round(capHeight(display, numberPx) + pad * 2);
      if (s.touch === null) {
        pushShape(out, right - ammoW, bottom - ammoH, ammoW, ammoH, COLORS.hudFundo, Math.round(8 * sc));
        text(out, display, ammo.text, right - pad, bottom - ammoH + pad, numberPx, COLORS.texto, 0, 'right');
      }

      // Retícula e mensagens no centro.
      const cy = f.y + f.height / 2;
      drawCrosshair(out, cx, cy, sc, s.hitMarker, s.dead);
      if (s.dead) {
        const headingPx = px(TYPE.heading, sc, f.minTextPx);
        text(
          out,
          display,
          respawning,
          cx,
          cy - capHeight(display, headingPx) / 2,
          headingPx,
          COLORS.texto,
          0.02,
          'center',
        );
      } else if (s.clickToAim) {
        text(out, hud, clickToAim, cx, cy + Math.round(48 * sc), captionPx, COLORS.texto, 0.02, 'center');
      }

      if (s.touch !== null) drawTouch(out, fonts, f, s.touch);
    },
  };
}
