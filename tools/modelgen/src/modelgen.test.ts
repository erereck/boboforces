import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  contentIdsOfKind,
  decodeModelPack,
  MODEL_FLAG,
  parseLayerManifest,
  propNavCells,
  REQUIRED_WEAPON_SOCKETS,
  WEAPON_SOCKETS,
  type ModelDocument,
} from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { buildModelOutputs, buildModels, validateModels, WEAPON_BOX_RANGE } from './generate.ts';
import { MODELGEN_OUTPUTS, MODELS_OUT_DIR, ROOT } from './paths.ts';

const build = buildModels();
const byId = new Map<string, ModelDocument>(build.pack.models.map((m) => [m.id, m]));

describe('modelgen', () => {
  it('saídas cadastradas no runtime-assets.json', () => {
    const table = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
      files: Record<string, string>;
    };
    const sources = new Set(Object.values(table.files));
    for (const file of Object.values(MODELGEN_OUTPUTS))
      expect(sources.has(`models/generated/${file}`), file).toBe(true);
  });

  it('todo model:* do registro de conteúdo tem modelo, e o pacote passa na validação', () => {
    expect([...byId.keys()]).toEqual(contentIdsOfKind('model'));
    expect(validateModels(build)).toEqual([]);
  });

  it('é determinístico e os arquivos gravados estão em dia (rode npm run modelgen)', () => {
    const a = buildModelOutputs().files;
    const b = buildModelOutputs().files;
    for (const [name, bytes] of a) {
      expect(Buffer.compare(bytes, b.get(name)!), name).toBe(0);
      const path = join(MODELS_OUT_DIR, name);
      expect(existsSync(path), name).toBe(true);
      expect(Buffer.compare(readFileSync(path), bytes), `${name} desatualizado`).toBe(0);
    }
  });

  it('o .bfmodel gravado volta igual e o manifesto de camadas lê', () => {
    const pack = decodeModelPack(readFileSync(join(MODELS_OUT_DIR, MODELGEN_OUTPUTS.pack)));
    expect(pack).toEqual(build.pack);
    const manifest = parseLayerManifest(
      JSON.parse(readFileSync(join(MODELS_OUT_DIR, MODELGEN_OUTPUTS.layersJson), 'utf8')),
    );
    const names = new Set(manifest.layers.map((l) => l.name));
    for (const m of pack.models) {
      for (const p of m.parts) {
        for (const b of p.boxes) expect(names.has(b.layer), b.layer).toBe(true);
        for (const s of p.meshes) expect(names.has(s.layer), s.layer).toBe(true);
      }
    }
    expect(manifest.layers.find((l) => l.name === 'mdl_glow')?.kind).toBe('emissive');
  });

  it('armas: soquetes obrigatórios, só nomes de arma, 6 a 20 caixas e peças para animar', () => {
    for (const id of ['pistol', 'rifle', 'sniper']) {
      const m = byId.get(id)!;
      const names = m.sockets.map((s) => s.name);
      for (const s of REQUIRED_WEAPON_SOCKETS) expect(names, id).toContain(s);
      expect(names.every((n) => (WEAPON_SOCKETS as readonly string[]).includes(n))).toBe(true);
      expect(names).toContain('mag');
      const boxes = m.parts.reduce((n, p) => n + p.boxes.length, 0);
      expect(boxes).toBeGreaterThanOrEqual(WEAPON_BOX_RANGE.min);
      expect(boxes).toBeLessThanOrEqual(WEAPON_BOX_RANGE.max);
      expect(m.parts.map((p) => p.name)).toEqual(expect.arrayContaining(['body', 'mag', 'bolt']));
      // O cano aponta para −Z: o muzzle é o ponto mais à frente.
      const muzzle = m.sockets.find((s) => s.name === 'muzzle')!;
      expect(muzzle.direction).toEqual([0, 0, -1]);
      for (const p of m.parts)
        for (const b of p.boxes) expect(b.origin[2] + p.pivot[2]).toBeGreaterThanOrEqual(muzzle.position[2]);
    }
  });

  it('props: colisor apoiado no chão, pegada em múltiplos de 0,5 m e regras de navegação', () => {
    for (const m of build.pack.models.filter((d) => d.kind === 'prop')) {
      expect(m.colliders.length, m.id).toBeGreaterThan(0);
      expect(Math.min(...m.colliders.map((c) => c.min[1])), m.id).toBe(0);
      for (const c of m.colliders) {
        expect((c.max[0] - c.min[0]) % 16, `${m.id} largura`).toBe(0);
        expect((c.max[2] - c.min[2]) % 16, `${m.id} profundidade`).toBe(0);
      }
      const cells = propNavCells(m, { x: 0, y: 0, z: 0, yaw: 0, scale: 16 });
      if (m.blocksNav) expect(cells.length, m.id).toBeGreaterThan(0);
      else
        expect(Math.max(...m.colliders.map((c) => c.max[1])), `${m.id} sem nav precisa ser degrau`).toBeLessThanOrEqual(
          16,
        );
    }
    expect(byId.get('floodlight')!.light?.level).toBe(14);
    expect(byId.get('floodlight')!.flags & MODEL_FLAG.emissive).not.toBe(0);
    expect(byId.get('tree')!.flags & MODEL_FLAG.swaysInWind).not.toBe(0);
  });

  it('malhas: o sentido dos triângulos bate com a normal gravada (anti-horário visto de fora)', () => {
    for (const m of build.pack.models) {
      for (const part of m.parts) {
        for (const mesh of part.meshes) {
          const p = mesh.positions;
          for (let t = 0; t < mesh.indices.length; t += 3) {
            const [a, b, c] = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
            const e1 = [p[b * 3]! - p[a * 3]!, p[b * 3 + 1]! - p[a * 3 + 1]!, p[b * 3 + 2]! - p[a * 3 + 2]!];
            const e2 = [p[c * 3]! - p[a * 3]!, p[c * 3 + 1]! - p[a * 3 + 1]!, p[c * 3 + 2]! - p[a * 3 + 2]!];
            const n = [
              e1[1]! * e2[2]! - e1[2]! * e2[1]!,
              e1[2]! * e2[0]! - e1[0]! * e2[2]!,
              e1[0]! * e2[1]! - e1[1]! * e2[0]!,
            ];
            const area = Math.hypot(n[0]!, n[1]!, n[2]!);
            if (area < 1) continue; // triângulo degenerado pelo arredondamento ao texel (ponta de cone)
            const dot =
              n[0]! * mesh.normals[a * 3]! + n[1]! * mesh.normals[a * 3 + 1]! + n[2]! * mesh.normals[a * 3 + 2]!;
            expect(dot, `${m.id} triângulo ${t / 3}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('modelo pronto com ID não registrado fica fora do pacote', () => {
    for (const m of build.pending) expect(byId.has(m.doc.id)).toBe(false);
  });
});
