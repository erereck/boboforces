import { ENTITY_FLAG, ENTITY_KIND, MAX_ENTITIES, MAX_HUMANS, MAX_TEAMS, type SimView } from '@boboforces/sim';
import { CELLS_PER_METER } from '@boboforces/world';
import { AI_TEAM } from './config.ts';

/**
 * M2 (fases 3e e 3f): o quadro do time, montado uma vez por partida no diretor (gameplay.md §6.3):
 * - **avisos (N3):** quem vê um inimigo avisa o time (posição e tick), num anel fixo; os aliados N3 sem pista vão
 *   atrás, e o \`game\` mostra um ícone de ping para os humanos do time;
 * - **objetivos (N3):** o objetivo de passeio de cada bot, para os outros andarem em dupla ou trio com um líder;
 * - **calor (N4):** células de 4 m por time, com onde os humanos inimigos ficam (amostra a cada 1 s) e de onde matam
 *   (peso maior), e onde o próprio time morreu (perigo). Tudo decai pela metade em ~2 min (\`AI_TEAM.heatHalfLifeS\`).
 * Lê só a \`SimView\` (contadores de abate e morte, posições); sem alocação depois da criação.
 */
export class TeamBoard {
  readonly cellsX: number;
  readonly cellsZ: number;
  /** Calor de inimigo e de perigo, \`MAX_TEAMS × células\`. */
  readonly heat: Float32Array;
  readonly danger: Float32Array;
  readonly pingX = new Float64Array(AI_TEAM.pingCapacity);
  readonly pingY = new Float64Array(AI_TEAM.pingCapacity);
  readonly pingZ = new Float64Array(AI_TEAM.pingCapacity);
  readonly pingTick = new Int32Array(AI_TEAM.pingCapacity).fill(-1_000_000);
  readonly pingTeam = new Uint8Array(AI_TEAM.pingCapacity);
  private pingHead = 0;
  /** Objetivo de passeio por entidade (m) e o tick em que foi escolhido. */
  readonly goalX = new Float64Array(MAX_ENTITIES);
  readonly goalZ = new Float64Array(MAX_ENTITIES);
  readonly goalTick = new Int32Array(MAX_ENTITIES).fill(-1_000_000);
  private readonly lastKills = new Uint16Array(MAX_ENTITIES);
  private readonly lastDeaths = new Uint16Array(MAX_ENTITIES);
  private nextSampleTick = 0;
  private readonly sampleTicks: number;
  private readonly decay: number;
  private readonly ffa: boolean;

  constructor(sizeXCells: number, sizeZCells: number, hz: number, ffa: boolean) {
    this.ffa = ffa;
    this.cellsX = Math.max(1, Math.ceil(sizeXCells / CELLS_PER_METER / AI_TEAM.heatCellM));
    this.cellsZ = Math.max(1, Math.ceil(sizeZCells / CELLS_PER_METER / AI_TEAM.heatCellM));
    this.heat = new Float32Array(MAX_TEAMS * this.cellsX * this.cellsZ);
    this.danger = new Float32Array(MAX_TEAMS * this.cellsX * this.cellsZ);
    this.sampleTicks = Math.max(1, Math.round(AI_TEAM.heatSampleS * hz));
    this.decay = Math.pow(0.5, AI_TEAM.heatSampleS / AI_TEAM.heatHalfLifeS);
  }

  /** Célula (índice dentro do time) de um ponto em metros; -1 fora da grade. */
  cell(x: number, z: number): number {
    const cx = Math.floor(x / AI_TEAM.heatCellM);
    const cz = Math.floor(z / AI_TEAM.heatCellM);
    if (cx < 0 || cz < 0 || cx >= this.cellsX || cz >= this.cellsZ) return -1;
    return cz * this.cellsX + cx;
  }

  /** Centro (m) de uma célula, em \`out[0]\` e \`out[1]\` (x, z). */
  cellCenter(cell: number, out: Float64Array): void {
    out[0] = ((cell % this.cellsX) + 0.5) * AI_TEAM.heatCellM;
    out[1] = (Math.floor(cell / this.cellsX) + 0.5) * AI_TEAM.heatCellM;
  }

  /** Uma vez por tick, antes dos cérebros: abates e mortes novos, e a amostra de 1 s (com o decaimento). */
  update(view: SimView, tick: number): void {
    const n = this.cellsX * this.cellsZ;
    for (let i = 0; i < view.count; i++) {
      if (view.alive[i] === 0 || view.kind[i] !== ENTITY_KIND.bobo) continue;
      const k = view.kills[i]!;
      const d = view.deaths[i]!;
      const human = view.controller[i]! >= 0 && view.controller[i]! < MAX_HUMANS;
      // Humano matou: o calor "de onde ele mata" sobe para os times inimigos dele.
      if (k > this.lastKills[i]! && human)
        this.addEnemyHeat(view, i, AI_TEAM.heatKillWeight * (k - this.lastKills[i]!), n);
      // Bobo morreu: perigo para o time dele, onde caiu.
      if (d > this.lastDeaths[i]!) {
        const c = this.cell(view.position[i * 3]!, view.position[i * 3 + 2]!);
        if (c >= 0) {
          const k2 = (this.ffa ? 0 : view.team[i]!) * n + c;
          this.danger[k2] = this.danger[k2]! + AI_TEAM.dangerWeight;
        }
      }
      this.lastKills[i] = k;
      this.lastDeaths[i] = d;
    }
    if (tick < this.nextSampleTick) return;
    this.nextSampleTick = tick + this.sampleTicks;
    for (let j = 0; j < this.heat.length; j++) {
      this.heat[j] = this.heat[j]! * this.decay;
      this.danger[j] = this.danger[j]! * this.decay;
    }
    for (let i = 0; i < view.count; i++) {
      if (view.alive[i] === 0 || view.kind[i] !== ENTITY_KIND.bobo || (view.flags[i]! & ENTITY_FLAG.dead) !== 0)
        continue;
      const c = view.controller[i]!;
      if (c >= 0 && c < MAX_HUMANS) this.addEnemyHeat(view, i, 1, n);
    }
  }

  /** Soma calor na célula do humano \`i\` para cada time inimigo dele (no FFA, para o "time" único dos bots). */
  private addEnemyHeat(view: SimView, i: number, w: number, n: number): void {
    const c = this.cell(view.position[i * 3]!, view.position[i * 3 + 2]!);
    if (c < 0) return;
    if (this.ffa) {
      this.heat[c] = this.heat[c]! + w;
      return;
    }
    const own = view.team[i]!;
    for (let t = 0; t < MAX_TEAMS; t++) if (t !== own) this.heat[t * n + c] = this.heat[t * n + c]! + w;
  }

  /** Avisa o time (N3): um inimigo em (x, y, z) agora. */
  post(team: number, x: number, y: number, z: number, tick: number): void {
    const k = this.pingHead;
    this.pingHead = (k + 1) % AI_TEAM.pingCapacity;
    this.pingX[k] = x;
    this.pingY[k] = y;
    this.pingZ[k] = z;
    this.pingTick[k] = tick;
    this.pingTeam[k] = this.ffa ? 0 : team;
  }

  /** O aviso mais novo do time, com até \`maxAge\` ticks e a até \`maxM\` m de (x, z); -1 se nenhum. */
  freshest(team: number, x: number, z: number, tick: number, maxAge: number, maxM: number): number {
    let best = -1;
    const t = this.ffa ? 0 : team;
    for (let k = 0; k < AI_TEAM.pingCapacity; k++) {
      if (this.pingTeam[k] !== t || tick - this.pingTick[k]! > maxAge) continue;
      const dx = this.pingX[k]! - x;
      const dz = this.pingZ[k]! - z;
      if (dx * dx + dz * dz > maxM * maxM) continue;
      if (best < 0 || this.pingTick[k]! > this.pingTick[best]!) best = k;
    }
    return best;
  }

  /**
   * A célula mais quente (calor de inimigo) do time a \`minM\`..\`maxM\` m de (x, z), acima de \`minHeat\`; -1 se nenhuma.
   * Varre as células (centenas num mapa médio), então quem chama faz isso de tempos em tempos.
   */
  hottest(team: number, x: number, z: number, minM: number, maxM: number, minHeat: number): number {
    const n = this.cellsX * this.cellsZ;
    const base = (this.ffa ? 0 : team) * n;
    let best = -1;
    let bestHeat = minHeat;
    for (let c = 0; c < n; c++) {
      const h = this.heat[base + c]!;
      if (h <= bestHeat) continue;
      const cx = ((c % this.cellsX) + 0.5) * AI_TEAM.heatCellM - x;
      const cz = (Math.floor(c / this.cellsX) + 0.5) * AI_TEAM.heatCellM - z;
      const d2 = cx * cx + cz * cz;
      if (d2 < minM * minM || d2 > maxM * maxM) continue;
      best = c;
      bestHeat = h;
    }
    return best;
  }

  /** Perigo (mortes do próprio time, decaindo) na célula de (x, z). */
  dangerAt(team: number, x: number, z: number): number {
    const c = this.cell(x, z);
    return c < 0 ? 0 : this.danger[(this.ffa ? 0 : team) * this.cellsX * this.cellsZ + c]!;
  }
}
