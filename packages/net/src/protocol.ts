import { CHAOS_DEFAULTS, CONTENT_IDS, GAME_VERSION, MODIFIER_CONFLICTS, MODIFIERS } from '@boboforces/format';
import { StateHasher, type BitReader, type BitWriter } from '@boboforces/shared';
import {
  ARCADE_TUNING,
  BASE_HP,
  BIG_BRRT,
  BIG_BRRT_COOL,
  BOBO_NAV_METRICS,
  BOOM_BOX,
  CHAOS_BLAST,
  CHAOS_MODS,
  DESMONTADOR,
  DOMINATION,
  FORTRESS,
  HEADSHOT_MULTIPLIER,
  HORDE,
  JUGG_FIXED,
  JUGGERNAUT,
  MAP_WEAPONS,
  MATCH_DEFAULTS,
  METRICS,
  MOVEMENT_BOBO,
  MOVEMENT_DOWNED,
  MOVEMENT_TACTICAL,
  MOVEMENT_ZOMBIE,
  MOVEMENT_ZOMBIE_RUNNER,
  MOVEMENT_ZOMBIE_SLOW,
  MOVEMENT_ZOMBIE_SPRINTER,
  PART_DAMAGE_MULTIPLIER,
  ROYALE,
  ROYALE_RARITY,
  ROYALE_WEAPONS,
  SPREAD_STATE_MULTIPLIER,
  STRIKE,
  STRIKE_SHOP,
  WEAPON_FIRE,
  WEAPONS,
  WEAPONS_M10,
  ZOMBIE_BARRICADES,
  ZOMBIE_BOX,
  ZOMBIE_DROPS,
  ZOMBIE_GOO,
  ZOMBIE_KINDS,
  ZOMBIE_PERKS,
  ZOMBIE_POINTS,
  ZOMBIE_RULES,
  ZOMBIE_SHOP,
  ZOMBIE_SPECIALS,
  ZOMBIE_SPIT,
  ZOMBIES_DOWN,
  ZOMBIES_MODE,
  MOVEMENT_ARCADE,
} from '@boboforces/sim';

/**
 * Protocolo do online (M5, tecnico.md §13). Sobe 1 a cada mudança no formato das mensagens; o handshake recusa
 * versões diferentes (quem está na mais antiga atualiza). M9 (fase 5): 12, o começo leva a opção do dono (`owner`).
 * M10 (fase 7): 13, o evento `projectile` ganhou a ação `stick` (o virote da besta cravado; o campo passa a 2 bits).
 * M11 (fase 4, revisão): 14, o grupo de entidade `rules` (a máscara das armas de cada um, que o dono muda no host).
 * M12 (fase 6): 15, o estado de movimento do dono (`priv`) ganhou o agachar guardado do deslize no pouso.
 */
export const PROTOCOL_VERSION = 15;

/** Teto de uma mensagem (tecnico.md §13.2): um snapshot maior vai em partes, por prioridade de entidade. */
export const MAX_MESSAGE_BYTES = 1100;

/** Primeiro byte de toda mensagem. Valor novo entra no fim. Do 7 ao 11, o lobby (`lobby.ts`). */
export const MSG = {
  hello: 1,
  welcome: 2,
  reject: 3,
  snapshot: 4,
  input: 5,
  events: 6,
  lobby: 7,
  choice: 8,
  start: 9,
  kick: 10,
  leave: 11,
  /** M5 (fase 5a): o host foi para segundo plano (1) ou voltou (0); pelo canal confiável, do lado "partida". */
  hostAway: 12,
  /** M5 (fase 5b): o host fechou a sala de propósito (quem cair sem isto tenta voltar). Do lado "lobby". */
  close: 13,
} as const;

/** Canal da mensagem: confiável e ordenado (handshake, lobby, eventos) ou não confiável (entradas e snapshots). */
export type NetChannel = 'reliable' | 'unreliable';

/** Tick nenhum (snapshot completo, sem base; ou "ainda não recebi snapshot"). */
export const NO_TICK = 0xffffffff;

/**
 * Tabelas que mexem na sim (tecnico.md §13.3: "registro de IDs e tabelas de armas e regras"). Host e cliente com
 * tabelas diferentes simulariam outra coisa: o hash entra no handshake. Tabela nova da sim entra aqui.
 */
export const SIM_CONTENT_TABLES: readonly unknown[] = [
  CONTENT_IDS,
  METRICS,
  PART_DAMAGE_MULTIPLIER,
  HEADSHOT_MULTIPLIER,
  BASE_HP,
  MOVEMENT_BOBO,
  MOVEMENT_TACTICAL,
  // M8 (fase 7): o Arcade.
  MOVEMENT_ARCADE,
  ARCADE_TUNING,
  MATCH_DEFAULTS,
  WEAPON_FIRE,
  WEAPONS,
  ZOMBIE_GOO,
  ZOMBIE_SPIT,
  DESMONTADOR,
  SPREAD_STATE_MULTIPLIER,
  BOBO_NAV_METRICS,
  ZOMBIE_RULES,
  MOVEMENT_ZOMBIE,
  MOVEMENT_ZOMBIE_RUNNER,
  MOVEMENT_ZOMBIE_SLOW,
  MOVEMENT_ZOMBIE_SPRINTER,
  MOVEMENT_DOWNED,
  ZOMBIES_MODE,
  ZOMBIE_POINTS,
  ZOMBIES_DOWN,
  ZOMBIE_KINDS,
  ZOMBIE_SPECIALS,
  ZOMBIE_BARRICADES,
  ZOMBIE_SHOP,
  ZOMBIE_BOX,
  ZOMBIE_PERKS,
  ZOMBIE_DROPS,
  // M6: os modos novos (fase 1: os pontos do Domination; fase 3: a Big Brrt e o Jugg).
  DOMINATION,
  BIG_BRRT,
  BIG_BRRT_COOL,
  JUGGERNAUT,
  // Fase 4: os modificadores e a Roleta.
  MODIFIERS,
  MODIFIER_CONFLICTS,
  CHAOS_DEFAULTS,
  CHAOS_MODS,
  CHAOS_BLAST,
  // Fase 6: o gerador do Fortress e a Horda armada.
  FORTRESS,
  HORDE,
  // M7 (fase 0): o Jugg Fixo (as rodadas). Fase 2: o BoboStrike (a loja, a economia e a Boom Box).
  JUGG_FIXED,
  STRIKE,
  STRIKE_SHOP,
  BOOM_BOX,
  // Fase 6: o Bobo Royale (a zona, o loot e as armas raras e épicas).
  ROYALE,
  ROYALE_RARITY,
  ROYALE_WEAPONS,
  // M10 (fases 6 e 7): as armas novas (DMR, revólver, escopeta automática, besta e lança-granadas).
  WEAPONS_M10,
  // M11 (fase 4): as armas no mapa (a volta da arma e o alcance da troca; o jogo de antes não sabe desenhar o ponto
  // vazio nem tira o radial: o hash recusa a mistura, sem mexer no formato da rede).
  MAP_WEAPONS,
];

/** Hash do conteúdo que mexe na sim (FNV-1a do JSON das tabelas, na ordem fixa). Uma vez por partida. */
export function simContentHash(tables: readonly unknown[] = SIM_CONTENT_TABLES): number {
  const h = new StateHasher();
  for (const t of tables) h.string(JSON.stringify(t) ?? 'undefined');
  return h.digest();
}

/** O que cada lado diz de si no handshake. */
export interface NetHello {
  readonly protocolVersion: number;
  /** `GAME_VERSION` (version.json): só ASCII visível, até 32 caracteres. */
  readonly gameVersion: string;
  readonly contentHash: number;
  /**
   * M5 (fase 5b, protocolo 2): o id do aparelho (16 dígitos hexadecimais; `''` = nenhum). O host reconhece quem caiu e
   * volta (o boneco é dele de novo) e quem ele tirou (não volta naquela sala).
   */
  readonly deviceId?: string;
}

/** Id do aparelho: 16 dígitos hexadecimais em minúscula (64 bits). */
export const DEVICE_ID_RE = /^[0-9a-f]{16}$/;

/** O hello desta build. */
export function localHello(): NetHello {
  return { protocolVersion: PROTOCOL_VERSION, gameVersion: GAME_VERSION, contentHash: simContentHash() };
}

const MAX_VERSION_CHARS = 32;

function writeAscii(w: BitWriter, s: string): void {
  const n = Math.min(s.length, MAX_VERSION_CHARS);
  w.writeBits(n, 8);
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    w.writeBits(c >= 0x20 && c <= 0x7e ? c : 0x3f, 8);
  }
}

function readAscii(r: BitReader): string {
  const n = Math.min(r.readBits(8), MAX_VERSION_CHARS);
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(r.readBits(8));
  return s;
}

export function writeHello(w: BitWriter, hello: NetHello): void {
  w.writeBits(MSG.hello, 8);
  w.writeBits(hello.protocolVersion, 16);
  w.writeBits(hello.contentHash >>> 0, 32);
  writeAscii(w, hello.gameVersion);
  // Protocolo 2: o id do aparelho em 2 × 32 bits (zeros = nenhum).
  const id = hello.deviceId !== undefined && DEVICE_ID_RE.test(hello.deviceId) ? hello.deviceId : '';
  w.writeBits(id === '' ? 0 : Number.parseInt(id.slice(0, 8), 16) >>> 0, 32);
  w.writeBits(id === '' ? 0 : Number.parseInt(id.slice(8), 16) >>> 0, 32);
}

/** O hello sem o id do aparelho (a recusa do host leva só isto). */
function readHelloCore(r: BitReader): NetHello {
  const protocolVersion = r.readBits(16);
  const contentHash = r.readBits(32) >>> 0;
  return { protocolVersion, gameVersion: readAscii(r), contentHash };
}

/** Lê o corpo de um hello (o tipo já foi lido). */
export function readHello(r: BitReader): NetHello {
  const core = readHelloCore(r);
  // Um hello do protocolo 1 acaba aqui: a versão já o recusa, sem id.
  if (core.protocolVersion < 2) return core;
  const hi = r.readBits(32) >>> 0;
  const lo = r.readBits(32) >>> 0;
  if (hi === 0 && lo === 0) return core;
  return { ...core, deviceId: hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0') };
}

/** Compara versões "a.b.c" (partes que faltam valem 0; texto depois de "-" é ignorado). */
export function compareGameVersions(a: string, b: string): number {
  const pa = (a.split('-')[0] ?? '').split('.');
  const pb = (b.split('-')[0] ?? '').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.parseInt(pa[i] ?? '0', 10) || 0;
    const y = Number.parseInt(pb[i] ?? '0', 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Resultado do handshake visto deste lado (tecnico.md §13.3): `update-self` = "Atualize a página" (e o service worker
 * procura a nova), `update-friend` = "Seu amigo precisa atualizar", `mismatch` = mesma versão com conteúdo diferente
 * (build de desenvolvimento; os dois atualizam).
 */
export type HelloVerdict = 'ok' | 'update-self' | 'update-friend' | 'mismatch';

export function checkHello(local: NetHello, remote: NetHello): HelloVerdict {
  if (local.protocolVersion !== remote.protocolVersion) {
    return local.protocolVersion < remote.protocolVersion ? 'update-self' : 'update-friend';
  }
  if (local.contentHash === remote.contentHash) return 'ok';
  const order = compareGameVersions(local.gameVersion, remote.gameVersion);
  return order < 0 ? 'update-self' : order > 0 ? 'update-friend' : 'mismatch';
}

/** Motivo de recusa do host (`MSG.reject`). Valor novo entra no fim. */
export const REJECT_REASON = { version: 1, full: 2, locked: 3, kicked: 4 } as const;
export type RejectReason = (typeof REJECT_REASON)[keyof typeof REJECT_REASON];

/** Resposta do host ao hello: o controlador (slot) do cliente e o ritmo da partida. */
export interface NetWelcome {
  readonly slot: number;
  readonly hz: number;
  readonly snapshotHz: number;
}

export function writeWelcome(w: BitWriter, welcome: NetWelcome): void {
  w.writeBits(MSG.welcome, 8);
  w.writeBits(welcome.slot, 8);
  w.writeBits(welcome.hz, 8);
  w.writeBits(welcome.snapshotHz, 8);
}

export function readWelcome(r: BitReader): NetWelcome {
  const slot = r.readBits(8);
  const hz = r.readBits(8);
  return { slot, hz, snapshotHz: r.readBits(8) };
}

/** Recusa: o motivo e o hello do host (o cliente decide quem atualiza com `checkHello`). */
export function writeReject(w: BitWriter, reason: RejectReason, host: NetHello): void {
  w.writeBits(MSG.reject, 8);
  w.writeBits(reason, 8);
  w.writeBits(host.protocolVersion, 16);
  w.writeBits(host.contentHash >>> 0, 32);
  writeAscii(w, host.gameVersion);
}

export function readReject(r: BitReader): { readonly reason: number; readonly host: NetHello } {
  const reason = r.readBits(8);
  return { reason, host: readHelloCore(r) };
}

/** Diferença entre dois `seq` de 16 bits (com a volta): positivo = `a` depois de `b`. */
export function seqDiff(a: number, b: number): number {
  return ((((a - b) & 0xffff) + 0x8000) & 0xffff) - 0x8000;
}
