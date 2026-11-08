/**
 * Tabelas do vértice do cenário (tecnico.md §6.2 e §6.3): normais (as 6 dos eixos iguais a `FACE`, as diagonais da
 * cruz e as rampas), tangentes e empacotadores. O vértice compacto de 12 bytes do M1 está em `region.ts`; o vértice
 * de 2 buffers e o mesher por chunk do M0 saíram na integração do M1.
 */
/**
 * Tabela de normais (até 32). Os 6 primeiros índices são FIXOS e iguais a `FACE` (+X, -X, +Y, -Y, +Z, -Z); as diagonais
 * das cruzes e as rampas 1:1 e 1:2 entram a partir do índice 6 no M1, sem mudar os 6 primeiros.
 */
export const NORMAL_TABLE: readonly (readonly [number, number, number])[] = buildNormalTable();

/**
 * Índices da tabela de normais (contrato do M1, até 32; usados 26). Os 6 eixos são os do M0 (= `FACE`). Depois:
 * - 6..9: as duas diagonais da cruz, frente e verso: (1,0,1), (-1,0,-1), (1,0,-1), (-1,0,1) normalizados;
 * - 10..13: plano da rampa 1:1 virado para cima, giros 0..3 (canônica (0,1,1)/√2: sobe para -Z, encara +Z);
 * - 14..17: rampa 1:1 invertida (para baixo), giros 0..3 (canônica (0,-1,1)/√2);
 * - 18..21: rampa 1:2 para cima, giros 0..3 (canônica (0,2,1)/√5);
 * - 22..25: rampa 1:2 invertida, giros 0..3 (canônica (0,-2,1)/√5).
 * As quinas de rampa 1:1 usam os planos da rampa 1:1 (cada triângulo da quina é o plano de um giro).
 * Giro = quarto de volta anti-horário visto de cima, igual à célula: (x, z) → (z, −x) para vetores.
 */
export const NORMAL = {
  px: 0,
  nx: 1,
  py: 2,
  ny: 3,
  pz: 4,
  nz: 5,
  /** Primeiro índice das diagonais da cruz (4 seguidos). */
  cross: 6,
  /** Primeiro índice da rampa 1:1 para cima (+giro). */
  rampUp: 10,
  rampDown: 14,
  rampHalfUp: 18,
  rampHalfDown: 22,
  /** Quantos índices estão em uso. */
  count: 26,
} as const;

/** Normal do plano de rampa: `kind` 1 = 1:1, 2 = 1:2; giro 0..3; invertida = virada para baixo. */
export function rampNormalIndex(kind: 1 | 2, rotation: number, flipped: boolean): number {
  const base =
    kind === 1 ? (flipped ? NORMAL.rampDown : NORMAL.rampUp) : flipped ? NORMAL.rampHalfDown : NORMAL.rampHalfUp;
  return base + (rotation & 3);
}

type Vec3 = readonly [number, number, number];

function normalize(v: Vec3): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Gira um vetor em quartos de volta anti-horários vistos de cima: (x, z) → (z, −x) por quarto. */
function rotateQuarter(v: Vec3, quarters: number): [number, number, number] {
  let x = v[0];
  let z = v[2];
  for (let i = 0; i < (quarters & 3); i++) {
    const nx = z;
    z = -x;
    x = nx;
  }
  return [x + 0, v[1], z + 0];
}

function buildNormalTable(): [number, number, number][] {
  const table: [number, number, number][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (const d of [
    [1, 0, 1],
    [-1, 0, -1],
    [1, 0, -1],
    [-1, 0, 1],
  ] as const)
    table.push(normalize(d));
  for (const canonical of [
    [0, 1, 1],
    [0, -1, 1],
    [0, 2, 1],
    [0, -2, 1],
  ] as const) {
    for (let r = 0; r < 4; r++) table.push(normalize(rotateQuarter(canonical, r)));
  }
  return table;
}

/**
 * Tangente e bitangente de cada normal, para a UV no shader: `uv = vec2(dot(p, T), dot(p, B)) × 2` (p em metros; a
 * textura repete a cada 0,5 m em qualquer plano, inclusive inclinado). Regra: T = normalize(cima × N) e B = T × N
 * (B aponta "para baixo" na textura: a linha 0 do PNG fica em cima); para ±Y, T = +X e B = ±Z como no M0.
 */
export const TANGENT_TABLE: readonly Vec3[] = NORMAL_TABLE.map((n) => tangentOf(n));
export const BITANGENT_TABLE: readonly Vec3[] = NORMAL_TABLE.map((n, i) => {
  const t = TANGENT_TABLE[i]!;
  if (n[0] === 0 && n[2] === 0) return [0, 0, n[1] > 0 ? 1 : -1] as const;
  return normalize([t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]]);
});

function tangentOf(n: Vec3): Vec3 {
  if (n[0] === 0 && n[2] === 0) return [1, 0, 0];
  // cima × N = (0,1,0) × (x,y,z) = (z, 0, −x)
  return normalize([n[2], 0, -n[0] + 0]);
}

export function packNormalAo(normal: number, ao: number, colorVariation: boolean): number {
  return (normal & 31) | ((ao & 3) << 5) | ((colorVariation ? 1 : 0) << 7);
}

export function packLight(sky: number, sun: number): number {
  return (sky & 15) | ((sun & 15) << 4);
}
