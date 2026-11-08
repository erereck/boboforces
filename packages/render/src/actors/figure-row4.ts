// 4ª linha das matrizes de osso do boneco do FutBobo (#56, PLANO do porte §B10 e §C7). O FK (`figureFk` do format) só
// escreve as 3 primeiras linhas (afim); a 4ª, que a GPU não precisa para uma afim, leva os dados por instância do
// programa 4 sem atributo novo: luz do céu, do sol, emissivo e, empacotados num float só, a expressão do rosto e o
// clarão de dano. O vertex shader refaz a matriz com (0, 0, 0, 1) e lê estes 4 números. Sem three.

/**
 * Escreve a 4ª linha da matriz coluna-maior em m[o .. o+16): m[o+3] = céu, m[o+7] = sol, m[o+11] = emissivo e
 * m[o+15] = 2·expressão + clamp01(clarão). `expression` é inteiro 0..7 (`FACE_EXPRESSION`); o clarão fica em [0, 1]
 * (NaN vale 0). Com e ≤ 7 o valor fica < 16 e o float32 guarda o clarão com erro ≤ 1e−6.
 */
export function writeFigureRow4(
  m: Float32Array,
  o: number,
  sky: number,
  sun: number,
  emissive: number,
  expression: number,
  flash: number,
): void {
  // quente:
  m[o + 3] = sky;
  m[o + 7] = sun;
  m[o + 11] = emissive;
  m[o + 15] = 2 * expression + (flash > 0 ? (flash < 1 ? flash : 1) : 0);
  // fim-quente
}

/**
 * Expressão de volta do 4º componente da última coluna (`w` = m[o+15]): floor(0,5·w + 0,001). Gêmeo do vertex shader,
 * que faz a mesma conta em float32: com o clarão em 1,0 o w é ímpar (2e + 1), 0,5·w = e + 0,5 e o floor ainda dá e; o
 * 0,001 cobre o w de float32 um pouco abaixo de 2e.
 */
export function figureRow4Expression(w: number): number {
  return Math.floor(0.5 * w + 0.001);
}
