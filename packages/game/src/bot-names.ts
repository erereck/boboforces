import type { Rng } from '@boboforces/shared';

// Gerador de nomes bobos em inglês (§6.7, #15: "Private Pickles", "Sergeant Noodle"). Nomes de bot são dado do
// jogador, como os de fábrica: ficam em inglês, fora da tabela de textos. M9 (fase 5b): saiu do `lab.ts` para os bots
// da reserva do dono ganharem nome na cena sem o chunk dela puxar a Oficina.
const RANKS = ['Private', 'Corporal', 'Sergeant', 'Captain', 'Major', 'Colonel', 'General', 'Cadet', 'Agent', 'Doctor'];
const NOUNS = [
  'Pickles',
  'Noodle',
  'Waffle',
  'Biscuit',
  'Nugget',
  'Muffin',
  'Pudding',
  'Taco',
  'Meatball',
  'Pancake',
  'Dumpling',
  'Bagel',
  'Cupcake',
  'Potato',
  'Burrito',
  'Nacho',
  'Sprinkles',
  'Toast',
];

/**
 * Um nome bobo novo, fora dos já usados (no limite, ganha um número). M9 (fase 5b, revisão): o número também fica fora
 * dos usados (sobe até achar um livre: `taken` é finito).
 */
export function rollBotName(rng: Rng, taken: ReadonlySet<string>): string {
  for (let tries = 0; tries < 40; tries++) {
    const name = `${RANKS[rng.int(0, RANKS.length)]!} ${NOUNS[rng.int(0, NOUNS.length)]!}`;
    if (!taken.has(name)) return name;
  }
  for (let n = rng.int(2, 100); ; n++) {
    const name = `${RANKS[0]!} ${NOUNS[0]!} ${n}`;
    if (!taken.has(name)) return name;
  }
}
