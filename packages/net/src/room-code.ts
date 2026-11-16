/**
 * O código da sala (tecnico.md §13.2): 5 caracteres de um alfabeto sem os que se confundem (0/O, 1/I), digitável no
 * controle e ditável em voz alta. 32⁵ ≈ 33 milhões de códigos: sala entre amigos, não busca. O link `#sala=XXXXX`
 * usa o hash: ele não vai a servidor nenhum.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
const HASH_KEY = 'sala=';

/** Um código novo. `random` em [0, 1) (na web, `crypto.getRandomValues` pela casca; nos testes, uma semente). */
export function newRoomCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length) % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * O que a pessoa digitou ou colou vira código: maiúsculas, sem espaço nem traço. Os ambíguos (0/O, 1/I) não estão no
 * alfabeto: quem os digitar recebe `null` (a tela diz "código inválido").
 */
export function normalizeRoomCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** O hash do link da sala (`#sala=ABCDE`). */
export function roomLinkHash(code: string): string {
  return `#${HASH_KEY}${code}`;
}

/** O código de um hash de link (`#sala=ABCDE`, maiúsculas ou não), ou `null`. */
export function parseRoomHash(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of h.split('&')) {
    if (!part.toLowerCase().startsWith(HASH_KEY)) continue;
    try {
      return normalizeRoomCode(decodeURIComponent(part.slice(HASH_KEY.length)));
    } catch {
      // `%` estragado no link.
      return null;
    }
  }
  return null;
}
