// E.7 (parte do render, PLANO do porte §E): o gêmeo do vertex shader (`figure-cube.ts`, conta a conta em float32) para
// TODA caixa de todo gabarito (os 12 looks, o zumbi e os 34 cortes × 5 chapéus): cada vértice no retângulo da sua face
// (= `addTexturedBox` com a mesma cruz), medida 0 no centro do texel, rosto na célula da expressão, Rx·Rz = referência
// da CPU, a frente do cubo Ry(π) no +z do FutBobo e o desempacotamento exato de 0..63.
import {
  boxCrossRects,
  FACE_EXPRESSIONS,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_FLAG,
  FIGURE_BOX_STRIDE,
  FIGURE_HEADWEAR,
  FIGURE_LAYOUT,
  FIGURE_LOOK_DEFAULT,
  FIGURE_MAX_BOXES,
  FIGURE_PRESETS,
  buildFigureTemplate,
  normalizeFigureLook,
  type FigureLook,
} from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import {
  buildFigureCubeGeometry,
  figureQuotient,
  figureVertexLocal,
  figureVertexTexel,
  FIGURE_CUBE_INDICES,
  FIGURE_CUBE_VERTICES,
  writeFigureBoxData,
} from './figure-cube.ts';
import { addTexturedBox, GeometryBuilder } from './geometry.ts';
import { FIGURE_INST, INSTANCE_FLOATS, VERT_COMPONENTS, VERTEX_FLAG } from './layout.ts';

const F = FIGURE_BOX_FIELD;
const cube = buildFigureCubeGeometry();

/** Gabaritos de todos os looks do teste: presets + 34 cortes × 5 chapéus (com barba longa e brincos alternados). */
function allTemplates(): { name: string; boxes: Float32Array; count: number }[] {
  const looks: { name: string; look: FigureLook }[] = Object.entries(FIGURE_PRESETS).map(([name, look]) => ({
    name,
    look,
  }));
  for (let hairStyle = 0; hairStyle < 34; hairStyle++) {
    for (const headwear of Object.values(FIGURE_HEADWEAR)) {
      looks.push({
        name: `corte-${hairStyle}-chapeu-${headwear}`,
        look: normalizeFigureLook({
          ...FIGURE_LOOK_DEFAULT,
          hairStyle,
          headwear,
          beard: hairStyle % 5 === 0 ? 8 : 0,
          earrings: hairStyle % 4,
        }),
      });
    }
  }
  return looks.map(({ name, look }) => {
    const boxes = new Float32Array(FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE);
    const count = buildFigureTemplate(look, boxes, 0);
    return { name, boxes, count };
  });
}

/** Face do BF (ordem de `FACE`: +X, −X, +Y, −Y, +Z, −Z) do vértice k pelo giro Ry(π) da normal do cubo. */
function bfFace(k: number): number {
  const nx = -cube.normals[k * 3]!;
  const ny = cube.normals[k * 3 + 1]!;
  const nz = -cube.normals[k * 3 + 2]!;
  if (Math.abs(nx) > 0.5) return nx > 0 ? 0 : 1;
  if (Math.abs(ny) > 0.5) return ny > 0 ? 2 : 3;
  return nz > 0 ? 4 : 5;
}

describe('cubo das figuras e gêmeo do VS (E.7)', () => {
  it('cubo: 24 vértices, 36 índices, frente (+z do FutBobo) com a flag do rosto e Ry(π) da addTexturedBox', () => {
    expect(cube.vertexCount).toBe(FIGURE_CUBE_VERTICES);
    expect(cube.indexCount).toBe(FIGURE_CUBE_INDICES);
    let front = 0;
    for (let k = 0; k < cube.vertexCount; k++) {
      const flags = cube.verts[k * VERT_COMPONENTS + 1]!;
      expect(flags & VERTEX_FLAG.box).toBe(VERTEX_FLAG.box);
      const isFront = cube.normals[k * 3 + 2]! > 0.5;
      expect((flags & VERTEX_FLAG.face) !== 0).toBe(isFront);
      if (isFront) {
        front++;
        // A frente do FutBobo é a "frente −Z" (face 5) do BF.
        expect(bfFace(k)).toBe(5);
        expect(cube.positions[k * 3 + 2]).toBeCloseTo(0.5, 6);
      }
    }
    expect(front).toBe(4);
    // +X do BF ("direita" da cruz) cai em −x do FutBobo, a direita do boneco (o +x do FutBobo é a esquerda).
    for (let k = 0; k < cube.vertexCount; k++) if (bfFace(k) === 0) expect(cube.normals[k * 3]).toBe(-1);
  });

  it('toda caixa de todo gabarito: vértice = addTexturedBox da mesma cruz; medida 0 no centro do texel', () => {
    const data = new Float32Array(INSTANCE_FLOATS);
    const tex = new Float32Array(2);
    let boxes = 0;
    let checked = 0;
    const bad: string[] = [];
    for (const t of allTemplates()) {
      for (let b = 0; b < t.count; b++) {
        const bo = b * FIGURE_BOX_STRIDE;
        writeFigureBoxData(data, 0, t.boxes, bo, 0, 255);
        const u = t.boxes[bo + F.u]!;
        const v = t.boxes[bo + F.v]!;
        const w = t.boxes[bo + F.w]!;
        const h = t.boxes[bo + F.h]!;
        const d = t.boxes[bo + F.d]!;
        const ref = new GeometryBuilder();
        addTexturedBox(
          ref,
          {
            min: [-0.5, -0.5, -0.5],
            size: [1, 1, 1],
            inflate: 0,
            tex: [w, h, d],
            uv: [u, v],
            layerSize: 1,
            mirror: false,
          },
          { layer: -1, flags: 0 },
        );
        const rects = boxCrossRects(u, v, w, h, d);
        const faceBox = (Math.round(t.boxes[bo + F.flags]!) & FIGURE_BOX_FLAG.face) !== 0;
        for (let k = 0; k < cube.vertexCount; k++) {
          figureVertexTexel(cube, k, data, 0, 0, tex, 0);
          // A frente da caixa com rosto lê a célula da expressão 0, (0, 32): a frente (16, 16) − (16, −16).
          const faceV = faceBox && (cube.verts[k * VERT_COMPONENTS + 1]! & VERTEX_FLAG.face) !== 0;
          if (faceV) {
            tex[0] = tex[0]! + 16;
            tex[1] = tex[1]! - 16;
          }
          const eu = ref.uvs[k * 2]! + (w + d === 0 ? 0.5 : 0);
          const ev = ref.uvs[k * 2 + 1]! + (h + d === 0 ? 0.5 : 0);
          // Dentro do retângulo da face (medida 0: o centro do texel do canto).
          const r = rects[bfFace(k)]!;
          const inside =
            tex[0]! >= r.u &&
            tex[0]! <= r.u + Math.max(r.w, 0.5) &&
            tex[1]! >= r.v &&
            tex[1]! <= r.v + Math.max(r.h, 0.5);
          // Um `expect` por vértice pesa (centenas de milhares): junta as falhas e confere no fim.
          if (tex[0] !== eu || tex[1] !== ev || !inside) {
            if (bad.length < 5) bad.push(`${t.name} caixa ${b} vértice ${k}: ${tex[0]},${tex[1]} ≠ ${eu},${ev}`);
            else bad.push('');
          }
          checked++;
        }
        boxes++;
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    // 12 presets e 170 combinações de corte × chapéu: milhares de caixas, cada uma com 24 vértices.
    expect(boxes).toBeGreaterThan(2000);
    expect(checked).toBe(boxes * 24);
  }, 30000);

  it('farda (#58): manga, antebraço, coxa e canela leem as colunas de 4 t no centro (u + 0,5) de v a v + h', () => {
    const t = new Float32Array(FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE);
    buildFigureTemplate(FIGURE_PRESETS.recruit, t, 0);
    const L = FIGURE_LAYOUT;
    const data = new Float32Array(INSTANCE_FLOATS);
    const tex = new Float32Array(2);
    for (const [boxes, col] of [
      [[2, 3], L.sleeve],
      [[4, 5], L.forearm],
      [[6, 7], L.thigh],
      [[8, 9], L.shin],
    ] as const) {
      for (const b of boxes) {
        const bo = b * FIGURE_BOX_STRIDE;
        expect([F.layer, F.u, F.v, F.w, F.h, F.d].map((f) => t[bo + f])).toEqual([
          col.layer,
          col.u,
          col.v,
          0,
          col.h,
          0,
        ]);
        writeFigureBoxData(data, 0, t, bo, 0, 255);
        let vMin = Infinity;
        let vMax = -Infinity;
        for (let k = 0; k < cube.vertexCount; k++) {
          figureVertexTexel(cube, k, data, 0, 0, tex, 0);
          // As 4 faces de lado lêem a mesma coluna; topo e base, a 1ª e a última linha (largura 0 = o centro do texel).
          expect(tex[0], `caixa ${b}`).toBe(col.u + 0.5);
          vMin = Math.min(vMin, tex[1]!);
          vMax = Math.max(vMax, tex[1]!);
        }
        expect([vMin, vMax], `caixa ${b}`).toEqual([col.v, col.v + col.h]);
      }
    }
  });

  it('rosto: a frente da cabeça lê a célula de cada expressão; as outras faces não mudam', () => {
    const t = new Float32Array(FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE);
    buildFigureTemplate(FIGURE_LOOK_DEFAULT, t, 0);
    expect(t[F.flags]! & FIGURE_BOX_FLAG.face).toBe(FIGURE_BOX_FLAG.face);
    const data = new Float32Array(INSTANCE_FLOATS);
    writeFigureBoxData(data, 0, t, 0, 4, 255);
    // A mesma caixa sem a flag do rosto: a UV da cruz pura (a frente em (16, 16)).
    const plain = new Float32Array(data);
    plain[FIGURE_INST.flags] = plain[FIGURE_INST.flags]! - FIGURE_BOX_FLAG.face;
    const tex = new Float32Array(2);
    const base = new Float32Array(2);
    const cell = FIGURE_LAYOUT.expressions.cell;
    for (let e = 0; e < FACE_EXPRESSIONS.length; e++) {
      const cu = cell * (e % 4);
      const cv = FIGURE_LAYOUT.expressions.v + cell * Math.floor(e / 4);
      for (let k = 0; k < cube.vertexCount; k++) {
        figureVertexTexel(cube, k, data, 0, e, tex, 0);
        figureVertexTexel(cube, k, plain, 0, e, base, 0);
        if ((cube.verts[k * VERT_COMPONENTS + 1]! & VERTEX_FLAG.face) !== 0) {
          expect(base[0]! >= 16 && base[0]! <= 32 && base[1]! >= 16 && base[1]! <= 32).toBe(true);
          expect(tex[0]! >= cu && tex[0]! <= cu + cell, `e=${e} u`).toBe(true);
          expect(tex[1]! >= cv && tex[1]! <= cv + cell, `e=${e} v`).toBe(true);
          // O canto da célula corresponde ao canto da frente (16, 16).
          expect(tex[0]! - cu).toBe(base[0]! - 16);
          expect(tex[1]! - cv).toBe(base[1]! - 16);
        } else {
          expect(tex[0]).toBe(base[0]);
          expect(tex[1]).toBe(base[1]);
        }
      }
    }
    // Caixa sem a flag `face` (o tronco) nunca desloca.
    writeFigureBoxData(data, 0, t, FIGURE_BOX_STRIDE, 4, 255);
    for (let k = 0; k < cube.vertexCount; k++) {
      figureVertexTexel(cube, k, data, 0, 7, tex, 0);
      figureVertexTexel(cube, k, data, 0, 0, base, 0);
      expect([tex[0], tex[1]]).toEqual([base[0], base[1]]);
    }
  });

  it('giro próprio Rx·Rz do VS = referência da CPU (≤ 1e−5) na posição e na normal', () => {
    const t = new Float32Array(FIGURE_BOX_STRIDE);
    const data = new Float32Array(INSTANCE_FLOATS);
    const out = new Float32Array(6);
    let worst = 0;
    for (let s = 0; s < 200; s++) {
      const rx = Math.sin(s * 1.7) * 3;
      const rz = Math.cos(s * 2.3) * 3;
      t[F.cx] = Math.sin(s) * 3;
      t[F.cy] = 4 + Math.cos(s);
      t[F.cz] = Math.sin(s * 0.5);
      t[F.sx] = 1 + (s % 7);
      t[F.sy] = 0.5 + (s % 5);
      t[F.sz] = 2 + (s % 3);
      t[F.rotX] = rx;
      t[F.rotZ] = rz;
      writeFigureBoxData(data, 0, t, 0, 0, 255);
      // R = Rx·Rz em dupla precisão.
      const cx = Math.cos(rx);
      const sx = Math.sin(rx);
      const cz = Math.cos(rz);
      const sz = Math.sin(rz);
      const R = [
        [cz, -sz, 0],
        [cx * sz, cx * cz, -sx],
        [sx * sz, sx * cz, cx],
      ];
      for (let k = 0; k < cube.vertexCount; k++) {
        figureVertexLocal(cube, k, data, 0, out, 0);
        const q = [0, 1, 2].map((a) => cube.positions[k * 3 + a]! * t[F.sx + a]!);
        const n = [0, 1, 2].map((a) => cube.normals[k * 3 + a]!);
        for (let r = 0; r < 3; r++) {
          const p = t[F.cx + r]! + R[r]![0]! * q[0]! + R[r]![1]! * q[1]! + R[r]![2]! * q[2]!;
          const m = R[r]![0]! * n[0]! + R[r]![1]! * n[1]! + R[r]![2]! * n[2]!;
          worst = Math.max(worst, Math.abs(out[r]! - p) / Math.max(1, Math.abs(p)), Math.abs(out[3 + r]! - m));
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(1e-5);
    // Sem giro: (1, 0, 1, 0) exatos.
    t[F.rotX] = 0;
    t[F.rotZ] = 0;
    writeFigureBoxData(data, 0, t, 0, 0, 255);
    expect([data[FIGURE_INST.cosX], data[FIGURE_INST.sinX], data[FIGURE_INST.cosZ], data[FIGURE_INST.sinZ]]).toEqual([
      1, 0, 1, 0,
    ]);
  });

  it('desempacotamento exato no padrão do Eden: w + 64h + 4096d para 0..63 (262.144 casos) e u0 + 64·v0', () => {
    const f32 = Math.fround;
    let bad = 0;
    for (let d = 0; d < 64; d++) {
      for (let h = 0; h < 64; h++) {
        for (let w = 0; w < 64; w++) {
          const dims = f32(w + 64 * h + 4096 * d);
          const dd = figureQuotient(dims, 4096);
          const rr = f32(dims - f32(dd * 4096));
          const dh = figureQuotient(rr, 64);
          const dw = f32(rr - f32(dh * 64));
          if (dd !== d || dh !== h || dw !== w) bad++;
        }
      }
    }
    expect(bad).toBe(0);
    for (let v = 0; v < 64; v++) {
      for (let u = 0; u < 64; u++) {
        const corner = f32(u + 64 * v);
        const v0 = figureQuotient(corner, 64);
        expect([f32(corner - f32(v0 * 64)), v0]).toEqual([u, v]);
      }
    }
    // Coeficientes do cubo: (aw + 3·ad, bh + 3·bd) com cada um em 0..2.
    for (let k = 0; k < cube.vertexCount; k++) {
      for (const c of [cube.uvs[k * 2]!, cube.uvs[k * 2 + 1]!]) {
        const a = figureQuotient(c, 3);
        expect(Number.isInteger(c) && a >= 0 && a <= 2 && c - 3 * a >= 0 && c - 3 * a <= 2).toBe(true);
      }
    }
  });
});
