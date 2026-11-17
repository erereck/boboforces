/**
 * O nome digitado (bot da Oficina, nome na sala do Online): só letras latinas, números, espaço e pontuação simples (o
 * que o atlas do HUD desenha), sem espaço repetido nem no começo. M5 (fase 4c): saiu do `lab.ts` para o Online usar
 * sem carregar o Laboratório; vale também para o nome que chega de um amigo pela rede (pode vir qualquer coisa).
 */
export function cleanTypedName(text: string, maxLength: number): string {
  return text
    .replace(/[^A-Za-z0-9À-ÖØ-öø-ÿ .,'!?&-]/gu, '')
    .replace(/\s+/gu, ' ')
    .trimStart()
    .slice(0, maxLength);
}

/**
 * Fora do atlas do HUD: o que não é Latin-1 imprimível nem a pontuação extra do `fontbake` (– — ‘ ’ “ ” • … €). Em
 * texto, com os códigos escritos, para não depender de caractere invisível no arquivo.
 */
const OUTSIDE_HUD_ATLAS = new RegExp(
  '[^\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac]',
  'gu',
);

/**
 * M5 (fase 4c): um texto que veio de outro aparelho para mostrar no HUD (o resumo da partida do host): só o que o
 * atlas do HUD tem, sem controle nenhum, e no máximo `maxLength`.
 */
export function cleanHudText(text: string, maxLength: number): string {
  return text.replace(OUTSIDE_HUD_ATLAS, '').slice(0, maxLength);
}
