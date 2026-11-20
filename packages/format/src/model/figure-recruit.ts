/**
 * O Recruta (PLANO do porte §B15), o visual pronto que o jogador 1 já usava e o "Meu Bobo" sem nada salvo. M9 (fase 0):
 * mora num módulo próprio para o `DEFAULT_BOBO` (no save, carregado pelo menu) não arrastar a tabela inteira de
 * `FIGURE_PRESETS` para o chunk do menu da web; a tabela usa este mesmo objeto.
 */
import { FIGURE_FABRIC, normalizeFigureLook, type FigureLook } from './figure-look.ts';

// Pele FB 4, cabelo FB 2, Raspado, Sério, sobrancelha Reta, olhos FB 1, sem capacete (#56/#57). Woodland, calça oliva,
// colete ranger, luvas e botas pretas (as mesmas cores de `BLACK_BOOTS` e `BLACK_GLOVES` da tabela).
export const RECRUIT_LOOK: FigureLook = normalizeFigureLook({
  skinTone: 0xcc8965,
  hair: 0x473023,
  eyes: 0x35251d,
  hairStyle: 5,
  face: 0,
  brow: 1,
  beard: 0,
  outfit: {
    fabric: FIGURE_FABRIC.woodland,
    jacket: 0x5d6b40,
    pants: 0x4e5838,
    vest: 0x434a31,
    boots: 0x1c1c1a,
    gloves: 0x262622,
  },
});
