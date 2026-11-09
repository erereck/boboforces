import { DEFAULT_TOUCH_LAYOUT, placeTouchButton, type InputMapper, type TouchButtonRect } from '@boboforces/input';
import {
  COLORS,
  drawText,
  measureText,
  pushShape,
  t,
  withAlpha,
  type DrawList,
  type MsdfFont,
  type StringKey,
  type UiFonts,
} from '@boboforces/ui';

const TOUCH_LABELS: Readonly<Record<string, StringKey>> = {
  fire: 'touch.fire',
  ads: 'touch.ads',
  jump: 'touch.jump',
  crouch: 'touch.crouch',
  reload: 'touch.reload',
  grenade: 'touch.grenade',
  weapon: 'touch.weapon',
  pause: 'touch.pause',
  melee: 'touch.melee',
  camera: 'touch.camera',
};

/** Onde desenhar (a superfície inteira: o toque só existe com 1 vista). */
export interface TouchOverlayFrame {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly minTextPx: number;
}

/**
 * Controles de toque por cima do HUD (celular; arte-ux.md §6.7): botões redondos com rótulo e o joystick virtual. O HUD
 * da vista (vida, munição, retícula) é o `drawHud` do ui; isto só desenha o que o mapeador de toque mostra. Sem
 * alocação depois da criação (rótulos resolvidos uma vez).
 */
export interface TouchOverlay {
  draw(out: DrawList, fonts: UiFonts | null, frame: TouchOverlayFrame, mapper: InputMapper): void;
  /**
   * M2 (fase 6e): o "fantasma dos dedos" (gameplay.md §2.5): um dedo andando em círculo na metade do joystick
   * ("arraste para andar") e outro varrendo a da mira ("arraste para mirar"), com a opacidade `alpha` (0..1).
   */
  drawGhost(
    out: DrawList,
    fonts: UiFonts | null,
    frame: TouchOverlayFrame,
    leftHanded: boolean,
    alpha: number,
    timeS: number,
  ): void;
}

export function createTouchOverlay(): TouchOverlay {
  const labels = new Map<string, string>();
  for (const [control, key] of Object.entries(TOUCH_LABELS)) labels.set(control, t(key).toUpperCase());
  const rect: TouchButtonRect = { control: 'fire', x: 0, y: 0, radius: 0 };
  const ghostMove = t('touch.ghost.move').toUpperCase();
  const ghostLook = t('touch.ghost.look').toUpperCase();
  const capHeight = (font: MsdfFont | undefined, size: number): number =>
    font ? (font.capHeight * size) / font.size : size * 0.7;
  return {
    draw(out, fonts, f, mapper): void {
      const layout = mapper.profile.touch ?? DEFAULT_TOUCH_LAYOUT;
      const font = fonts?.hud;
      const labelPx = Math.max(13 * f.pixelRatio, f.minTextPx * 0.75);
      for (let i = 0; i < layout.buttons.length; i++) {
        const b = placeTouchButton(layout, i, f.width, f.height, f.pixelRatio, rect);
        const down = mapper.isTouchControlDown(b.control);
        const size = b.radius * 2;
        const x = b.x - b.radius;
        const y = b.y - b.radius;
        pushShape(out, x, y, size, size, down ? withAlpha(COLORS.acao, 0.55) : COLORS.hudFundo, 0);
        pushShape(out, x, y, size, size, withAlpha(COLORS.texto, 0.5), 0, Math.max(1, Math.round(f.pixelRatio)));
        const label = labels.get(b.control) ?? '';
        if (font) {
          const w = measureText(font, label, labelPx, 0.04);
          drawText(out, font, label, b.x - w / 2, b.y - capHeight(font, labelPx) / 2, labelPx, COLORS.texto, 0.04);
        }
      }
      const js = mapper.touchJoystick;
      if (js.active) {
        const r = layout.joystickRadius * f.pixelRatio;
        pushShape(out, js.baseX - r, js.baseY - r, r * 2, r * 2, withAlpha(COLORS.texto, 0.4), 0, 2);
        const k = r * 0.45;
        pushShape(out, js.knobX - k, js.knobY - k, k * 2, k * 2, withAlpha(COLORS.texto, 0.6), 0);
      }
    },
    drawGhost(out, fonts, f, leftHanded, alpha, timeS): void {
      if (alpha <= 0) return;
      const pr = f.pixelRatio;
      const font = fonts?.hud;
      const labelPx = Math.max(16 * pr, f.minTextPx);
      const ring = withAlpha(COLORS.texto, 0.45 * alpha);
      const finger = withAlpha(COLORS.acao, 0.75 * alpha);
      const label = (text: string, x: number, y: number): void => {
        if (!font) return;
        const w = measureText(font, text, labelPx, 0.04);
        drawText(out, font, text, x - w / 2, y, labelPx, withAlpha(COLORS.texto, alpha), 0.04);
      };
      // O joystick: um anel e o dedo dando voltas dentro dele.
      const mx = (leftHanded ? 0.78 : 0.22) * f.width;
      const my = 0.66 * f.height;
      const r = 60 * pr;
      pushShape(out, mx - r, my - r, r * 2, r * 2, ring, 0, Math.max(2, Math.round(2 * pr)));
      const a = timeS * 2.4;
      const fr = 16 * pr;
      const fx = mx + Math.cos(a) * r * 0.5;
      const fy = my + Math.sin(a) * r * 0.5;
      pushShape(out, fx - fr, fy - fr, fr * 2, fr * 2, finger, 0);
      label(ghostMove, mx, my - r - labelPx * 1.6);
      // A mira: o dedo varrendo para os lados no meio da metade da mira.
      const lx = (leftHanded ? 0.4 : 0.6) * f.width;
      const ly = 0.42 * f.height;
      const sweep = Math.sin(timeS * 2) * 70 * pr;
      pushShape(out, lx + sweep - fr, ly - fr, fr * 2, fr * 2, finger, 0);
      pushShape(out, lx - 70 * pr, ly + fr + 6 * pr, 140 * pr, Math.max(2, 2 * pr), ring, 0);
      label(ghostLook, lx, ly - fr - labelPx * 1.6);
    },
  };
}
