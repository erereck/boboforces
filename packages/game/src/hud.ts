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
}

export function createTouchOverlay(): TouchOverlay {
  const labels = new Map<string, string>();
  for (const [control, key] of Object.entries(TOUCH_LABELS)) labels.set(control, t(key).toUpperCase());
  const rect: TouchButtonRect = { control: 'fire', x: 0, y: 0, radius: 0 };
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
  };
}
