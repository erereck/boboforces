// M12 (fase 4): os sons dos objetivos dos modos do M6 ao M11 (ARCHITECTURE §23.4), que eram mudos: a Boom Box que bipa
// cada vez mais rápido, plantar e desarmar; o ponto do Domination ganho e perdido em dois tons; a zona do Royale
// fechando; o começo e o fim da rodada; a Roleta que troca; o ping do time como bipe posicionado; e a arma do mapa que
// volta (baixinho, perto). Lê a vista no `frame()` como a contagem, e os eventos `point`, `signal` e `pickup`.
import {
  BOMB,
  NULL_ENTITY,
  PICKUP_KIND,
  ROUND,
  ROUND_PHASE,
  SIM_HZ,
  STRIKE,
  STRIKE_DATA,
  ZONE,
  entityIndex,
  type RoundsView,
  type SimEvent,
  type SimView,
} from '@boboforces/sim';
import { SOUND_RANK, type SoundId } from '../sound-bank.ts';

/** Os números (revisáveis). */
export const OBJECTIVE_SOUND = {
  /** A Boom Box plantada bipa a cada 1 s no começo e a cada 0,15 s no fim. */
  bombSlowS: 1,
  bombFastS: 0.15,
  /** O teclado de quem planta e a ferramenta de quem desarma. */
  plantTickS: 0.35,
  defuseTickS: 0.5,
  /** O ping longe vem de 8 m na direção dele (o lado fica, o volume não some). */
  pingNearM: 8,
  /** A arma do mapa que volta: só até aqui de um ouvinte, baixinho. */
  weaponBackM: 12,
  weaponBackGain: 0.35,
} as const;

/** O que o módulo usa da mixagem da partida (`scene/sound.ts`). */
export interface ObjectiveSoundPort {
  /** Na cabeça (sem posição), com cooldown. */
  flat(id: SoundId, nowS: number, volume: number, rate: number): void;
  /** No mundo; `nearM` > 0 traz o som para no máximo essa distância do ouvinte mais perto, na mesma direção. */
  at(
    id: SoundId,
    x: number,
    y: number,
    z: number,
    nowS: number,
    priority: number,
    volume: number,
    rate: number,
    nearM: number,
  ): void;
  /** Distância ao ouvinte mais perto. */
  listenerDistance(x: number, y: number, z: number): number;
  /** Time do jogador local 1 (`-1` sem time: FFA ou sem jogador). */
  myTeam(v: SimView): number;
  /** A entidade é um jogador local? */
  isLocal(entity: number): boolean;
}

export interface ObjectiveSound {
  frame(v: SimView, dt: number, nowS: number): void;
  event(ev: SimEvent, v: SimView, nowS: number): void;
}

/** A rodada que acabou fecha a partida? (Um time chegou às `winRounds`, ou foi a última das `totalRounds`.) */
export function decisive(r: RoundsView): boolean {
  const d = r.data;
  if (r.winRounds > 0 && Math.max(d[ROUND.wins0]!, d[ROUND.wins1]!) >= r.winRounds) return true;
  return r.totalRounds > 0 && d[ROUND.round]! >= r.totalRounds;
}

/** O intervalo do bipe da Boom Box com `bombTicks` sobrando: 1 s com ela recém-plantada, 0,15 s no fim. */
export function bombBeepInterval(bombTicks: number): number {
  const f = Math.min(1, Math.max(0, bombTicks / (STRIKE.bombS * SIM_HZ)));
  return OBJECTIVE_SOUND.bombFastS + (OBJECTIVE_SOUND.bombSlowS - OBJECTIVE_SOUND.bombFastS) * f;
}

export function createObjectiveSound(port: ObjectiveSoundPort): ObjectiveSound {
  /** O estado lido no frame anterior (-9 = ainda não leu: o 1º frame só guarda, não toca). */
  let bomb = -9;
  let roundPhase = -9;
  let zoneShrinking = -9;
  let chaosMask = -9;
  let beepT = 0;
  let plantT = 0;
  let defuseT = 0;
  let ended = false;

  const strikeFrame = (v: SimView, dt: number, nowS: number): void => {
    const st = v.strike;
    if (st === null) return;
    const d = st.data;
    const now = d[STRIKE_DATA.bomb]!;
    const px = st.pos[0]!;
    const py = st.pos[1]! + 0.3;
    const pz = st.pos[2]!;
    if (bomb !== -9 && now !== bomb) {
      if (now === BOMB.planted) {
        port.at('bomba-armada', px, py, pz, nowS, SOUND_RANK.hurt, 1, 1, 0);
        beepT = bombBeepInterval(d[STRIKE_DATA.bombTicks]!);
      } else if (now === BOMB.defused && bomb === BOMB.planted) {
        port.at('bomba-desarmada', px, py, pz, nowS, SOUND_RANK.hurt, 1, 1, 0);
      }
    }
    bomb = now;
    if (now === BOMB.planted && d[STRIKE_DATA.bombTicks]! > 0) {
      beepT -= dt;
      if (beepT <= 0) {
        port.at('bomba-bipe', px, py, pz, nowS, SOUND_RANK.enemy, 1, 1, 0);
        beepT = bombBeepInterval(d[STRIKE_DATA.bombTicks]!);
      }
    }
    // O teclado de quem planta (no corpo dele, agudo) e a ferramenta de quem desarma (na bomba, grave).
    const planter = d[STRIKE_DATA.planter]! >>> 0;
    const pi = entityIndex(planter);
    if (d[STRIKE_DATA.plantTicks]! > 0 && planter !== NULL_ENTITY && pi < v.count && v.alive[pi] === 1) {
      plantT -= dt;
      if (plantT <= 0) {
        const o = pi * 3;
        const y = v.position[o + 1]! + 1;
        port.at('tique', v.position[o]!, y, v.position[o + 2]!, nowS, SOUND_RANK.enemy, 1.5, 1.5, 0);
        plantT = OBJECTIVE_SOUND.plantTickS;
      }
    } else plantT = 0;
    if (now === BOMB.planted && d[STRIKE_DATA.defuseTicks]! > 0) {
      defuseT -= dt;
      if (defuseT <= 0) {
        port.at('tique', px, py, pz, nowS, SOUND_RANK.enemy, 1.5, 0.8, 0);
        defuseT = OBJECTIVE_SOUND.defuseTickS;
      }
    } else defuseT = 0;
  };

  const roundsFrame = (v: SimView, nowS: number): void => {
    const r = v.rounds;
    if (r === null) return;
    const phase = r.data[ROUND.phase]!;
    if (roundPhase !== -9 && phase !== roundPhase && r.data[ROUND.round]! > 0 && !ended) {
      if (phase === ROUND_PHASE.live) port.flat('contagem-vai', nowS, 0.8, 1);
      else if (phase === ROUND_PHASE.over && !decisive(r)) {
        // O fim da rodada que fecha a partida fica com a vinheta (revisão: a fase da partida só vira depois).
        const winner = r.data[ROUND.winner]!;
        const mine = port.myTeam(v);
        if (winner >= 0 && mine >= 0) port.flat(winner === mine ? 'ponto-ganho' : 'ponto-perdido', nowS, 1, 0.8);
      }
    }
    roundPhase = phase;
  };

  return {
    frame(v, dt, nowS) {
      ended = v.match.phase === 'ended';
      strikeFrame(v, dt, nowS);
      roundsFrame(v, nowS);
      // A zona do Royale começando a fechar.
      const ro = v.royale;
      if (ro !== null) {
        const shrinking = ro.data[ZONE.shrinking]!;
        if (zoneShrinking !== -9 && shrinking === 1 && zoneShrinking === 0 && !ended)
          port.flat('zona-fecha', nowS, 1, 1);
        zoneShrinking = shrinking;
      }
      // A Roleta do Chaos trocou os modificadores.
      const ch = v.chaos;
      if (ch !== null) {
        const mask = ch.masks[0]!;
        if (chaosMask !== -9 && mask !== chaosMask && !ended) port.flat('drop-pega', nowS, 0.8, 0.9);
        chaosMask = mask;
      }
    },
    event(ev, v, nowS) {
      switch (ev.type) {
        case 'point': {
          // O Domination: o seu time pegou (dois tons subindo) ou perdeu (descendo) um ponto; o outro time perdendo um
          // ponto é meio ganho (mais baixo).
          const mine = port.myTeam(v);
          if (mine < 0) break;
          const ours = ev.team === mine;
          if (ev.action === 'captured') port.flat(ours ? 'ponto-ganho' : 'ponto-perdido', nowS, 1, 1);
          else port.flat(ours ? 'ponto-perdido' : 'ponto-ganho', nowS, 0.6, 1);
          break;
        }
        case 'signal': {
          // O ping (o tipo 0) só para o time de quem mandou (ou para quem mandou); os emotes ficam mudos.
          if (ev.kind !== 0) break;
          const own = port.isLocal(ev.entity);
          if (!own) {
            const mine = port.myTeam(v);
            const i = entityIndex(ev.entity);
            if (mine < 0 || i >= v.count || v.team[i] !== mine) break;
          }
          const rank = own ? SOUND_RANK.own : SOUND_RANK.hurt;
          port.at('ping', ev.x, ev.y, ev.z, nowS, rank, 1, 1, OBJECTIVE_SOUND.pingNearM);
          break;
        }
        case 'pickup': {
          // A arma do mapa voltando ao ponto (a largada do tick 0 não conta), baixinho e só perto.
          if (
            ev.action !== 'drop' ||
            v.mapWeapons === null ||
            ev.entity !== NULL_ENTITY ||
            ev.tick <= 0 ||
            ev.kind < PICKUP_KIND.weaponBase ||
            ev.kind >= PICKUP_KIND.spotBase
          )
            break;
          if (port.listenerDistance(ev.x, ev.y, ev.z) > OBJECTIVE_SOUND.weaponBackM) break;
          const gain = OBJECTIVE_SOUND.weaponBackGain;
          port.at('drop-aparece', ev.x, ev.y + 0.5, ev.z, nowS, SOUND_RANK.world, gain, 1, 0);
          break;
        }
        default:
          break;
      }
    },
  };
}
