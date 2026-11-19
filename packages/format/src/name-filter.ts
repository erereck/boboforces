/**
 * M8 (fase 0): o filtro simples de nomes (GDD §4.8, "Limites e moderação"): pt-BR e inglês, sem acento, com a troca de
 * números e símbolos por letras e as letras repetidas juntadas ("fuuu" vira "fu"). Vale para o que chega de outro
 * aparelho (os códigos, os links) e para o que se digita; o nome barrado vira um nome do gerador (quem chama decide).
 * Local e sem rede. Sem `normalize`/`Intl` (regra 13: o Switch pode não ter os dados de Unicode): os acentos saem por
 * tabela.
 *
 * Duas listas: as **raízes** casam em qualquer parte do nome ("PutaMerda" pega pela "merda"); as **palavras** curtas só
 * casam sozinhas, para não barrar "Computador", "Disputa", "Desviado", "Knight", "Fagundes", "Pica-Pau" ou "Cockpit".
 */

/**
 * Fora do atlas do HUD (o `cleanHudText` do jogo): o que não é Latin-1 imprimível nem a pontuação extra do `fontbake`.
 * Tira também os controles, as quebras de linha e as marcas de direção que um nome de fora pode trazer.
 */
const OUTSIDE_HUD = new RegExp(
  '[^\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac]',
  'gu',
);

/** M8 (fase 1, revisão): o nome que veio de outro aparelho, só com o que a fonte desenha e sem espaço repetido. */
export function cleanSharedName(name: string, maxLength: number): string {
  // A quebra de linha vira espaço antes de os caracteres de fora saírem ("Jorge\nBob" fica "Jorge Bob").
  const text = name.replace(/\s+/gu, ' ').replace(OUTSIDE_HUD, '').replace(/ +/gu, ' ').trim();
  return Array.from(text).slice(0, maxLength).join('').trimEnd();
}

/** Casam em qualquer parte do nome (já sem acento e sem letra repetida). */
const ROOTS: readonly string[] = [
  // pt-BR
  'caralh',
  'buceta',
  'boceta',
  'porra',
  'merda',
  'bosta',
  'arromb',
  'foder',
  'fodid',
  'fodas',
  'xoxota',
  'xereca',
  'piroca',
  'punheta',
  'siririca',
  'vagabund',
  'filhadaputa',
  'filhodaputa',
  'cuzao',
  'traveco',
  'sapatao',
  'mongoloid',
  'crioul',
  // inglês
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'whore',
  'slut',
  'pusy',
  'penis',
  'vagina',
  'porn',
  'asshole',
  'bastard',
  'wank',
  'hitler',
  'nazista',
  'retard',
  'dildo',
  'blowjob',
];

/** Só casam como palavra inteira (ou com as letras separadas por espaço: "p u t a"). */
const WORDS: ReadonlySet<string> = new Set([
  // pt-BR
  'puta',
  'puto',
  'putas',
  'putos',
  'cu',
  'cus',
  'fdp',
  'pqp',
  'vsf',
  'tnc',
  'krl',
  'crl',
  'viado',
  'viados',
  'bicha',
  'bichas',
  'foda',
  'fode',
  'cacete',
  'corno',
  'otario',
  // inglês
  'ass',
  'fag',
  'fuk',
  'cock',
  'cocks',
  'cum',
  'tits',
  'rape',
  'nazi',
  'nazis',
  'twat',
  'sex',
]);

/** Letras com acento, números e símbolos que viram letra (o resto vira espaço). */
const FOLD: Readonly<Record<string, string>> = {
  à: 'a',
  á: 'a',
  â: 'a',
  ã: 'a',
  ä: 'a',
  å: 'a',
  è: 'e',
  é: 'e',
  ê: 'e',
  ë: 'e',
  ì: 'i',
  í: 'i',
  î: 'i',
  ï: 'i',
  ò: 'o',
  ó: 'o',
  ô: 'o',
  õ: 'o',
  ö: 'o',
  ù: 'u',
  ú: 'u',
  û: 'u',
  ü: 'u',
  ç: 'c',
  ñ: 'n',
  ý: 'y',
  ÿ: 'y',
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '6': 'g',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
};

/** Invisíveis que alguns apps põem no meio do texto (o acento solto, o hífen suave, a largura zero): somem. */
const INVISIBLE = /[\u0300-\u036f\u00ad\u200b-\u200d\u2060\ufeff]/gu;

/** Os símbolos que viram letra (fora deles, só letras e números formam palavra). */
const LEET_SYMBOLS = '@$!';

/**
 * As palavras do nome: minúsculas, sem acento e sem invisíveis; letras, números e `@ $ !` ficam juntos. Só a palavra
 * que tem letra troca números e símbolos por letras ("Bot 455" não vira "ass").
 */
function tokensOf(text: string): string[] {
  const out: string[] = [];
  for (const raw of text
    .toLowerCase()
    .replace(INVISIBLE, '')
    .split(/[^a-z0-9@$!\u00e0-\u00ff]+/u)) {
    if (raw === '') continue;
    let t = '';
    let letter = false;
    for (const ch of raw) {
      const f = ch >= 'a' && ch <= 'z' ? ch : (FOLD[ch] ?? '');
      if (f !== '' && !(ch >= '0' && ch <= '9') && !LEET_SYMBOLS.includes(ch)) letter = true;
      t += f;
    }
    if (letter && t !== '') out.push(t);
  }
  return out;
}

/** "fuuuck" → "fuck": as letras repetidas viram uma. */
function squeeze(text: string): string {
  let out = '';
  for (const ch of text) if (out[out.length - 1] !== ch) out += ch;
  return out;
}

/** "porrrra" → "porra": 3 ou mais da mesma letra viram 2 (as raízes com letra dobrada). */
function squeezeTo2(text: string): string {
  let out = '';
  for (const ch of text) if (!(out[out.length - 1] === ch && out[out.length - 2] === ch)) out += ch;
  return out;
}

function hasRoot(text: string): boolean {
  for (const root of ROOTS) {
    if (text.includes(root) || squeeze(text).includes(root) || squeezeTo2(text).includes(root)) return true;
  }
  return false;
}

function isWord(text: string): boolean {
  return WORDS.has(text) || WORDS.has(squeeze(text)) || WORDS.has(squeezeTo2(text));
}

/**
 * O nome passa no filtro? (o vazio passa: quem chama decide o que fazer com ele.) As raízes casam dentro de cada
 * palavra; as palavras curtas, sozinhas ou com a vizinha ("vi ado"); as letras soltas ("p u t a", "m e r d a")
 * contam como uma palavra só.
 */
export function isNameAllowed(name: string): boolean {
  const tokens = tokensOf(name);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (hasRoot(t) || isWord(t)) return false;
    if (i + 1 < tokens.length && isWord(t + tokens[i + 1]!)) return false;
  }
  // As letras e sílabas soltas seguidas (palavras de até 2 letras) contam juntas.
  let run = '';
  let count = 0;
  for (const t of [...tokens, '']) {
    if (t !== '' && t.length <= 2) {
      run += t;
      count++;
      continue;
    }
    if (count > 1 && (hasRoot(run) || isWord(run))) return false;
    run = '';
    count = 0;
  }
  return true;
}
