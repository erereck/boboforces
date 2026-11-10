import { fnv1a32, hashToHex } from '@boboforces/shared';
import { deflateSync, inflateSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  BFMAP_MAGIC,
  BFMAP_VERSION,
  decodeMap,
  encodeMap,
  MAP_CHUNK_VOLUME,
  isPlayableProp,
  MAP_FORMAT,
  OPTIONAL_MANNEQUINS,
  OPTIONAL_PRINT_CAMERAS,
  PLAYABLE_PROP_DOSE,
  PLAYABLE_PROP_DOSE_VIEW,
  PRINT_CAMERAS,
  PROP_DOSE,
  propCollidersToWorld,
  propLightCell,
  propPointToWorld,
  REQUIRED_BENCH_ROUTES,
  REQUIRED_MANNEQUINS,
  validateMap,
  type MapCamera,
  type MapDocument,
  type MapMannequin,
  type MapSpawnMarker,
} from './index.ts';
import { MANNEQUIN_POSES } from './validate.ts';

// Mapa sintético pequeno: 64×16×64 células (2×1×2 chunks), chão de concreto e uma caixa.
function syntheticMap(): MapDocument {
  const floor = new Uint16Array(MAP_CHUNK_VOLUME);
  for (let i = 0; i < 32 * 32; i++) floor[i] = 1; // camada y = 0
  floor[5 | (5 << 5) | (1 << 10)] = 2 | (1 << 10); // caixote girado 1 quarto em y = 1
  const spawns: MapSpawnMarker[] = [];
  for (let i = 0; i < 6; i++) spawns.push({ x: 2 + i, y: 0.5, z: 3, yaw: 0, team: 0 });
  for (let i = 0; i < 6; i++) spawns.push({ x: 2 + i, y: 0.5, z: 28, yaw: Math.PI, team: 1 });
  for (let i = 0; i < 16; i++)
    spawns.push({ x: 2 + (i % 8) * 3, y: 0.5, z: 10 + Math.floor(i / 8) * 8, yaw: 0, team: -1 });
  return {
    format: MAP_FORMAT,
    id: 'construto',
    meta: {
      nameKey: 'map.construto.name',
      modes: ['warfare.tdm', 'warfare.ffa'],
      players: { min: 2, ideal: 8, max: 16 },
      maxSightLineM: 30,
      botCaps: { switch34p: 12, pc: 24 },
    },
    blocks: ['air', 'concrete', 'crate'],
    grid: {
      sizeX: 64,
      sizeY: 16,
      sizeZ: 64,
      chunks: [
        { cx: 1, cy: 0, cz: 1, uniform: 1, cells: null },
        { cx: 0, cy: 0, cz: 0, uniform: 0, cells: floor },
        { cx: 1, cy: 0, cz: 0, uniform: 0, cells: null }, // só ar: não vai para o arquivo
      ],
    },
    props: [
      { model: 'barrel', x: 320, y: 16, z: 160, yaw: 0, scale: 16, dose: 0 },
      { model: 'jeep', x: 0, y: 16, z: 0, yaw: 64, scale: 16, dose: 1 },
      { model: 'barrel', x: 352, y: 16, z: 160, yaw: 255, scale: 20, dose: 2 },
    ],
    markers: {
      spawns,
      domination: [{ id: 'a', x: 16, y: 0.5, z: 16, radius: 4 }],
      cameras: [{ name: 'print:dia', x: 1, y: 2, z: 3, yaw: 0.5, pitch: -0.1, fovYDeg: 0 }],
      routes: [
        {
          name: 'bench:volta',
          loop: true,
          points: [
            { t: 0, x: 1, y: 2, z: 1, yaw: 0, pitch: 0 },
            { t: 10, x: 20, y: 2, z: 1, yaw: 1, pitch: 0 },
          ],
        },
      ],
      mannequins: [
        {
          name: 'vitrine:1',
          x: 4,
          y: 0.5,
          z: 4,
          yaw: 0,
          look: 'recruit',
          team: -1,
          zombie: false,
          pose: 'stand',
          weapon: 'rifle',
        },
      ],
      playArea: { minX: 1, minZ: 1, maxX: 31, maxZ: 31, killPlaneY: -10 },
    },
    light: { sunDir: [0.6, 0.8, 0], timeOfDay: 'day', emitters: [{ x: 3, y: 2, z: 3, level: 12 }] },
  };
}

describe('map@1 (.bfmap)', () => {
  it('ida e volta preserva o documento (chunks em ordem fixa, ar descartado)', () => {
    const doc = syntheticMap();
    const bytes = encodeMap(doc);
    const back = decodeMap(bytes);
    expect(back.id).toBe('construto');
    expect(back.meta).toEqual(doc.meta);
    expect(back.blocks).toEqual(doc.blocks);
    expect(back.props).toEqual(doc.props);
    expect(back.markers).toEqual(doc.markers);
    expect(back.light).toEqual(doc.light);
    expect(back.grid.chunks.map((c) => [c.cx, c.cy, c.cz])).toEqual([
      [0, 0, 0],
      [1, 0, 1],
    ]);
    expect(back.grid.chunks[0]!.cells).toEqual(doc.grid.chunks[1]!.cells);
    expect(back.grid.chunks[1]!.cells).toBeNull();
    expect(back.grid.chunks[1]!.uniform).toBe(1);
  });

  it('é determinístico e o mesmo documento dá os mesmos bytes', () => {
    const a = encodeMap(syntheticMap());
    const b = encodeMap(syntheticMap());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    // Reordenar a lista de chunks não muda o arquivo.
    const doc = syntheticMap();
    const reordered = { ...doc, grid: { ...doc.grid, chunks: [...doc.grid.chunks].reverse() } };
    expect(Buffer.from(encodeMap(reordered)).equals(Buffer.from(a))).toBe(true);
  });

  it('recusa provisório, versão maior, magia errada e seção ausente', () => {
    const header = (version: number, extra: number[] = []): Uint8Array => {
      const b = new Uint8Array(8 + extra.length);
      new DataView(b.buffer).setUint32(0, BFMAP_MAGIC, true);
      new DataView(b.buffer).setUint16(4, version, true);
      b.set(extra, 8);
      return deflateSync(b);
    };
    expect(() => decodeMap(header(0))).toThrow('npm run mapc');
    expect(() => decodeMap(header(2))).toThrow('mais nova');
    expect(() => decodeMap(deflateSync(new Uint8Array(8)))).toThrow('assinatura');
    expect(() => decodeMap(header(1))).toThrow('ausente');
    expect(() => decodeMap(new Uint8Array(0))).toThrow();
  });

  it('pula seção desconhecida e recusa dados truncados', () => {
    const raw = inflateSync(encodeMap(syntheticMap()));
    // Insere uma seção 'NAV ' de 3 bytes no fim e soma 1 ao nº de seções.
    const extra = new Uint8Array(raw.length + 11);
    extra.set(raw);
    extra.set([0x4e, 0x41, 0x56, 0x20, 3, 0, 0, 0, 9, 9, 9], raw.length);
    new DataView(extra.buffer).setUint16(6, 7, true);
    expect(decodeMap(deflateSync(extra)).blocks).toEqual(['air', 'concrete', 'crate']);
    expect(() => decodeMap(deflateSync(raw.subarray(0, raw.length - 5)))).toThrow('truncados');
  });

  it('recusa célula com bit reservado ou bloco além da tabela', () => {
    const doc = syntheticMap();
    const cells = new Uint16Array(MAP_CHUNK_VOLUME);
    cells[0] = 1;
    cells[1] = 0x2001;
    const bad = { ...doc, grid: { ...doc.grid, chunks: [{ cx: 0, cy: 0, cz: 0, uniform: 0, cells }] } };
    expect(() => decodeMap(encodeMap(bad))).toThrow('bit reservado');
    cells[1] = 7;
    expect(() => decodeMap(encodeMap(bad))).toThrow('além da tabela');
    expect(validateMap(bad).some((m) => m.includes('além da tabela'))).toBe(true);
  });

  it('recusa grade acima do teto antes de alocar', () => {
    const doc = syntheticMap();
    const raw = inflateSync(encodeMap(doc));
    // Acha a seção GRID e troca sizeX por 4096.
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let at = 8;
    for (;;) {
      const tag = String.fromCharCode(raw[at]!, raw[at + 1]!, raw[at + 2]!, raw[at + 3]!);
      const size = view.getUint32(at + 4, true);
      if (tag === 'GRID') break;
      at += 8 + size;
    }
    view.setUint16(at + 8, 4096, true);
    expect(() => decodeMap(deflateSync(raw))).toThrow('teto');
  });

  it('validador aceita o mapa sintético e aponta os problemas', () => {
    const doc = syntheticMap();
    expect(validateMap(doc)).toEqual([]);
    const strict = validateMap(doc, { requirePrintMarkers: true });
    expect(strict).toContain(`câmera obrigatória ausente: ${PRINT_CAMERAS[1]}`);
    expect(strict.some((m) => m.includes(REQUIRED_MANNEQUINS[1]))).toBe(true);
    expect(strict.some((m) => m.includes(REQUIRED_BENCH_ROUTES[0]))).toBe(false);

    const broken: MapDocument = {
      ...doc,
      blocks: ['air', 'concrete', 'unobtainium'],
      props: [{ model: 'ufo', x: 1, y: 1, z: 1, yaw: 0, scale: 16, dose: 1 }],
      meta: { ...doc.meta, modes: ['warfare.tdm', 'warfare.ffa', 'no.such'] },
      markers: { ...doc.markers, spawns: doc.markers.spawns.slice(3) },
      light: { ...doc.light, sunDir: [0, -1, 0] },
    };
    const issues = validateMap(broken);
    expect(issues).toContain('bloco não registrado: block:unobtainium');
    expect(issues).toContain('modelo não registrado: model:ufo');
    expect(issues).toContain('modo não registrado: mode:no.such');
    expect(issues.some((m) => m.startsWith('TDM: time 0 com 3 spawns'))).toBe(true);
    expect(issues.some((m) => m.includes('y > 0'))).toBe(true);
    // IDs conhecidos vindos de fora (ferramenta com o registro do mapa).
    expect(validateMap(broken, { knownBlocks: new Set(['concrete', 'unobtainium']) })).not.toContain(
      'bloco não registrado: block:unobtainium',
    );
  });

  it('régua de métricas (#53): print:altura e os manequins altura:* obrigatórios, cada um com a sua pose', () => {
    const doc = syntheticMap();
    const base = doc.markers.mannequins[0]!;
    const strict = validateMap(doc, { requirePrintMarkers: true });
    expect(strict).toContain('câmera obrigatória ausente: print:altura');
    expect(strict).toContain('manequim obrigatório ausente: altura:em-pe');
    expect(strict).toContain('manequim obrigatório ausente: altura:agachado');
    const swapped: MapDocument = {
      ...doc,
      markers: {
        ...doc.markers,
        mannequins: [
          ...doc.markers.mannequins,
          { ...base, name: 'altura:em-pe', pose: 'crouch' },
          { ...base, name: 'altura:agachado', pose: 'stand' },
        ],
      },
    };
    const issues = validateMap(swapped, { requirePrintMarkers: true });
    expect(issues).toContain('manequim altura:em-pe precisa da pose "stand" (régua de métricas)');
    expect(issues).toContain('manequim altura:agachado precisa da pose "crouch" (régua de métricas)');
    expect(issues.some((m) => m.includes('ausente: altura:'))).toBe(false);
    // Sem `requirePrintMarkers` (mapas que não são o Construto) a pose não é cobrada.
    expect(validateMap(swapped)).toEqual([]);
  });

  it('marcadores opcionais do boneco (PLANO do porte §B16): aceitos, com pose fixa e em grupo inteiro', () => {
    const doc = syntheticMap();
    const base = doc.markers.mannequins[0]!;
    const cam = doc.markers.cameras[0]!;
    const man = (name: string, pose: MapMannequin['pose']): MapMannequin => ({ ...base, name, pose });
    const required: MapMannequin[] = REQUIRED_MANNEQUINS.map((n) =>
      man(n, n === 'altura:agachado' ? 'crouch' : 'stand'),
    );
    const cams: MapCamera[] = [...PRINT_CAMERAS, ...OPTIONAL_PRINT_CAMERAS].map((name) => ({ ...cam, name }));
    const optional = OPTIONAL_MANNEQUINS.map((n) => man(n, n === 'altura:deslizando' ? 'slide' : 'stand'));
    const full: MapDocument = {
      ...doc,
      markers: { ...doc.markers, cameras: cams, mannequins: [...required, ...optional] },
    };
    // Tudo presente: nada a reclamar; sem os opcionais também (são opcionais).
    expect(validateMap(full, { requirePrintMarkers: true })).toEqual([]);
    const without: MapDocument = {
      ...full,
      markers: {
        ...full.markers,
        cameras: cams.filter((c) => !(OPTIONAL_PRINT_CAMERAS as readonly string[]).includes(c.name)),
        mannequins: required,
      },
    };
    expect(validateMap(without, { requirePrintMarkers: true })).toEqual([]);
    // A régua a 45° (decisão 6 da §I do PLANO) é opcional e sozinha: não é grupo (olha os `altura:*` obrigatórios).
    expect(OPTIONAL_PRINT_CAMERAS).toContain('print:altura-45');
    expect(PRINT_CAMERAS as readonly string[]).not.toContain('print:altura-45');
    const ruler45: MapDocument = {
      ...without,
      markers: { ...without.markers, cameras: [...without.markers.cameras, { ...cam, name: 'print:altura-45' }] },
    };
    expect(validateMap(ruler45, { requirePrintMarkers: true })).toEqual([]);
    // A régua exige o `slide` no deslizando; a fila e o close ficam em pé.
    const wrong: MapDocument = {
      ...full,
      markers: {
        ...full.markers,
        mannequins: full.markers.mannequins.map((q) =>
          q.name === 'altura:deslizando'
            ? { ...q, pose: 'crouch' }
            : q.name === 'linha:3'
              ? { ...q, pose: 'slide' }
              : q,
        ),
      },
    };
    const issues = validateMap(wrong, { requirePrintMarkers: true });
    expect(issues).toEqual([
      'manequim linha:3 precisa da pose "stand" (fila e close do boneco)',
      'manequim altura:deslizando precisa da pose "slide" (régua de métricas)',
    ]);
    // Grupo pela metade: a fila sem o linha:8 e o close sem a câmera.
    const partial: MapDocument = {
      ...full,
      markers: {
        ...full.markers,
        cameras: cams.filter((c) => c.name !== 'print:close-1m'),
        mannequins: full.markers.mannequins.filter((q) => q.name !== 'linha:8'),
      },
    };
    expect(validateMap(partial, { requirePrintMarkers: true })).toEqual([
      'grupo opcional "fila do boneco" pela metade: faltam linha:8',
      'grupo opcional "close do boneco" pela metade: faltam print:close-1m',
    ]);
    // Sem `requirePrintMarkers`, pose fixa e grupos não são cobrados; nomes reservados e pose desconhecida, sempre.
    expect(validateMap(wrong)).toEqual([]);
    expect(validateMap(partial)).toEqual([]);
    const stray: MapDocument = {
      ...doc,
      markers: {
        ...doc.markers,
        cameras: [
          ...doc.markers.cameras,
          { ...cam, name: 'print:linha-3q' },
          { ...cam, name: 'print:outra' },
          { ...cam, name: 'print:altura-30' },
        ],
        mannequins: [
          ...doc.markers.mannequins,
          man('linha:9', 'stand'),
          man('altura:sentado', 'stand'),
          man('vitrine:7', 'slide'),
          { ...base, name: 'pose:ruim', pose: 'kneel' as MapMannequin['pose'] },
        ],
      },
    };
    expect(validateMap(stray)).toEqual([
      'câmera print:linha-3q: nome de print reservado fora do contrato',
      'câmera print:altura-30: nome de print reservado fora do contrato',
      'manequim linha:9: nome de print reservado fora do contrato',
      'manequim altura:sentado: nome de print reservado fora do contrato',
      'manequim pose:ruim com pose desconhecida: kneel',
    ]);
    expect(MANNEQUIN_POSES).toEqual(['stand', 'crouch', 'aim', 'slide']);
  });

  it('validador confere rotas, nomes repetidos e spawns fora da área', () => {
    const doc = syntheticMap();
    const bad: MapDocument = {
      ...doc,
      markers: {
        ...doc.markers,
        spawns: [...doc.markers.spawns, { x: 100, y: 1, z: 1, yaw: 0, team: 0 }],
        cameras: [...doc.markers.cameras, ...doc.markers.cameras],
        routes: [
          {
            name: 'r',
            loop: false,
            points: [
              { t: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
              { t: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
            ],
          },
        ],
      },
    };
    const issues = validateMap(bad);
    expect(issues.some((m) => m.includes('fora da playArea'))).toBe(true);
    expect(issues).toContain('câmera repetido: print:dia');
    expect(issues).toContain('rota r precisa começar em t = 0');
    expect(issues).toContain('rota r: tempo não crescente no ponto 1');
  });
});

describe('map@1: pose slide sem subir o formato (PLANO do porte §B16, F-M5)', () => {
  const withPose = (pose: MapMannequin['pose']): MapDocument => {
    const doc = syntheticMap();
    const [first] = doc.markers.mannequins;
    return { ...doc, markers: { ...doc.markers, mannequins: [{ ...first!, name: 'altura:deslizando', pose }] } };
  };

  it('ida e volta da pose slide; o id do formato e a versão do arquivo continuam 1', () => {
    const doc = withPose('slide');
    const bytes = encodeMap(doc);
    expect(decodeMap(bytes).markers).toEqual(doc.markers);
    expect(MAP_FORMAT).toBe('boboforces/map@1');
    expect(BFMAP_VERSION).toBe(1);
    const raw = inflateSync(bytes);
    expect(new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint16(4, true)).toBe(1);
    // Pose fora da lista: o decodificador recusa (o codificador grava o texto como veio; quem barra antes é o validador).
    const bad = encodeMap(withPose('kneel' as MapMannequin['pose']));
    expect(() => decodeMap(bad)).toThrow('pose desconhecida: kneel');
  });

  it('o mapa que não usa slide sai com os mesmos bytes; com slide, só os 5 caracteres da pose mudam', () => {
    // Bytes travados do mapa sintético (só `stand`), o mesmo hash com o codificador do passo 0 (antes do `slide`).
    expect(hashToHex(fnv1a32(encodeMap(syntheticMap())))).toBe('9912e4c5');
    const a = inflateSync(encodeMap(withPose('stand')));
    const b = inflateSync(encodeMap(withPose('slide')));
    expect(b.length).toBe(a.length);
    const diff: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
    // "stand" × "slide": o "s" é igual, mudam os 4 seguintes, contíguos, dentro do JSON da MARK.
    expect(diff).toHaveLength(4);
    expect(diff[3]! - diff[0]!).toBe(3);
    expect(strFromU8(a.subarray(diff[0]! - 1, diff[0]! + 4))).toBe('stand');
    expect(strFromU8(b.subarray(diff[0]! - 1, diff[0]! + 4))).toBe('slide');
    expect(strFromU8(inflateSync(encodeMap(syntheticMap())))).not.toContain('slide');
  });
});

describe('map@1: props no mundo', () => {
  const prop = { model: 'pipe', x: 320, y: 32, z: 160, yaw: 0, scale: 16, dose: 1 } as const;

  it('ponto: giro anti-horário (a frente -Z vai para -X com +64 passos) e escala em 1/16', () => {
    const out = new Float64Array(3);
    propPointToWorld(prop, 0, 0, -32, out);
    expect([...out]).toEqual([10, 1, 4]);
    propPointToWorld({ ...prop, yaw: 64 }, 0, 0, -32, out);
    expect(out[0]).toBeCloseTo(9, 10);
    expect(out[2]).toBeCloseTo(5, 10);
    propPointToWorld({ ...prop, scale: 32 }, 0, 16, 0, out);
    expect(out[1]).toBe(2);
  });

  it('caixas: envolvente alinhada aos eixos depois do giro', () => {
    const pipe = [{ min: [-64, 0, -8], max: [64, 16, 8] }] as const;
    const out = new Float32Array(6);
    expect(propCollidersToWorld(prop, pipe, out)).toBe(1);
    expect([...out]).toEqual([8, 1, 4.75, 12, 1.5, 5.25]);
    propCollidersToWorld({ ...prop, yaw: 64 }, pipe, out);
    expect([...out]).toEqual([9.75, 1, 3, 10.25, 1.5, 7]);
    // 45°: a envolvente cresce (√2 da meia diagonal), sem colisor girado.
    propCollidersToWorld({ ...prop, yaw: 32 }, [{ min: [-16, 0, -16], max: [16, 32, 16] }], out);
    expect(out[3]! - out[0]!).toBeCloseTo(Math.SQRT2, 2);
  });

  it('luz: célula da grade, presa dentro dela', () => {
    const cell = [0, 0, 0];
    propLightCell(prop, [0, 64, 0], 160, 48, 160, cell);
    expect(cell).toEqual([20, 6, 10]);
    propLightCell({ ...prop, x: -5000 }, [0, 64, 0], 160, 48, 160, cell);
    expect(cell[0]).toBe(0);
  });

  it('dose do jogo: o dobro (decisão #52); todas as doses colidem e a vista padrão mostra todas', () => {
    expect(PLAYABLE_PROP_DOSE).toBe(PROP_DOSE.double);
    expect(PLAYABLE_PROP_DOSE_VIEW).toBe('double');
    expect(isPlayableProp({ dose: PROP_DOSE.always })).toBe(true);
    expect(isPlayableProp({ dose: PROP_DOSE.proposal })).toBe(true);
    expect(isPlayableProp({ dose: PROP_DOSE.double })).toBe(true);
  });
});

describe('map@1: janelas e portas do Bobo Zombies (M3, fase 3d)', () => {
  const withObjects = (): MapDocument => {
    const doc = syntheticMap();
    return {
      ...doc,
      markers: {
        ...doc.markers,
        barricades: [{ x: 4.5, y: 0.5, z: 6.25, outside: 2, width: 1, height: 2 }],
        paidDoors: [{ minX: 2, minY: 0.5, minZ: 6, maxX: 3, maxY: 2.5, maxZ: 6.5, cost: 750 }],
      },
    };
  };

  it('ida e volta; sem janela nem porta, os bytes do mapa sintético continuam os mesmos', () => {
    const doc = withObjects();
    expect(decodeMap(encodeMap(doc)).markers).toEqual(doc.markers);
    expect(hashToHex(fnv1a32(encodeMap(syntheticMap())))).toBe('9912e4c5');
    expect(decodeMap(encodeMap(syntheticMap())).markers.barricades).toBeUndefined();
    expect(validateMap(doc)).toEqual([]);
  });

  it('validador aponta lado de fora, vão, caixa vazia e preço inválidos', () => {
    const doc = withObjects();
    const bad: MapDocument = {
      ...doc,
      markers: {
        ...doc.markers,
        barricades: [{ x: 4.5, y: 0.5, z: 6.25, outside: 5 as 0, width: 0.2, height: 2 }],
        paidDoors: [{ minX: 3, minY: 0.5, minZ: 6, maxX: 3, maxY: 2.5, maxZ: 6.5, cost: -1 }],
      },
    };
    const issues = validateMap(bad);
    expect(issues).toContain('janela 0 com lado de fora fora de 0..3');
    expect(issues).toContain('janela 0 com vão fora de 0,5..4 m');
    expect(issues).toContain('porta 0 com caixa vazia');
    expect(issues).toContain('porta 0 com preço inválido');
  });
});
