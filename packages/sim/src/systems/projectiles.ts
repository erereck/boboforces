import { FIGURE_BONE, type FigurePart } from '@boboforces/format';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';
import { METRICS } from '../config/metrics.ts';
import { weaponDef, type WeaponDef } from '../config/weapons.ts';
import { hostile, isBody, PART_TORSO, type SimContext } from '../context.ts';
import { secondsToTicks } from '../constants.ts';
import { ENTITY_FLAG, type EntityId } from '../entity.ts';
import { figurePostureOf, weaponGrip } from '../hitbox.ts';

/**
 * Passo 4: projéteis (M2, fase 1b; tecnico.md §4.1). Foguete e granada vivem num pool fixo do estado
 * (`SimState.proj*`, no snapshot e no hash):
 * - **foguete:** reto (`projectileGravity` 0); a cada tick o segmento percorrido passa pela grade (blocos que param
 *   bala) e pelas hitboxes dos inimigos; o primeiro contato explode. Acerto direto: `damage` no alvo (sem a área nele)
 *   e a área nos outros. Sem contato, explode no fim do alcance (`rangeM / projectileSpeed`);
 * - **granada:** com gravidade, quica nos blocos (perde 60% da velocidade normal e 30% da tangente), atravessa corpos e
 *   explode no pavio (`fuseS`, menos o tempo cozinhando na mão).
 * A explosão (`explode`) cai em linha reta do centro até a borda, mede a distância até o ponto mais perto da AABB de
 * cada corpo, exige linha de visão do centro até esse ponto (blocos que param bala) e aplica `selfDamageMul` em quem
 * lançou (autodano, gameplay.md §5.1: 50%). Aliados não levam dano (fogo amigo desligado no M2). O dano vai para a fila
 * e só é aplicado no passo 5.
 */

const F = ENTITY_FLAG;
/** Restituição da granada na normal e o que sobra da velocidade tangente a cada quique. */
const BOUNCE_NORMAL = 0.4;
const BOUNCE_TANGENT = 0.7;
/** Abaixo disto (m/s) a granada para de quicar e fica parada. */
const REST_SPEED = 0.8;
/** Quique com som (evento `bounce`) só acima disto (m/s). */
const BOUNCE_EVENT_SPEED = 2;
/** Afastamento da superfície ao parar ou explodir num bloco (m). */
const SURFACE_OFFSET = 0.05;
/** Força mínima (m/s) do desmonte de quem morre na explosão, somada à da arma pela proximidade. */
const BLAST_MIN_FORCE = 4;

const rayHit = createRayHit();
const losHit = createRayHit();

/**
 * Lança um projétil da arma `def` por `owner`, em (x, y, z) com velocidade (vx, vy, vz) e pavio de `fuseTicks`.
 * Devolve o índice no pool, ou -1 se o pool estiver cheio (o projétil some sem efeito; só com bug: 512 lugares).
 */
export function launchProjectile(
  ctx: SimContext,
  owner: EntityId,
  def: WeaponDef,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  fuseTicks: number,
): number {
  const s = ctx.s;
  const p = s.allocateProjectile();
  if (p < 0) return -1;
  const p3 = p * 3;
  s.projWeapon[p] = def.code;
  s.projOwner[p] = owner;
  s.projPosition[p3] = x;
  s.projPosition[p3 + 1] = y;
  s.projPosition[p3 + 2] = z;
  s.projPrevPosition[p3] = x;
  s.projPrevPosition[p3 + 1] = y;
  s.projPrevPosition[p3 + 2] = z;
  s.projVelocity[p3] = vx;
  s.projVelocity[p3 + 1] = vy;
  s.projVelocity[p3 + 2] = vz;
  s.projFuseTicks[p] = Math.max(1, fuseTicks);
  ctx.events.projectile(ctx.tick, 'launch', p, def.code, owner, x, y, z, vx, vy, vz);
  return p;
}

/** Pavio do foguete em ticks: o tempo de voar o alcance da arma. */
export function rocketFuseTicks(def: WeaponDef, hz: number): number {
  return secondsToTicks(def.rangeM / Math.max(1, def.projectileSpeed), hz);
}

export function projectileSystem(ctx: SimContext): void {
  const s = ctx.s;
  const dt = ctx.dt;
  const n = s.projCount;
  for (let p = 0; p < n; p++) {
    if (s.projAlive[p] === 0) continue;
    const def = weaponDef(s.projWeapon[p]!);
    if (def === null) {
      s.freeProjectile(p);
      continue;
    }
    const p3 = p * 3;
    let vx = s.projVelocity[p3]!;
    let vy = s.projVelocity[p3 + 1]! - def.projectileGravity * dt;
    let vz = s.projVelocity[p3 + 2]!;
    const x = s.projPosition[p3]!;
    const y = s.projPosition[p3 + 1]!;
    const z = s.projPosition[p3 + 2]!;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const step = speed * dt;
    const owner = s.projOwner[p]!;

    if (def.fuseS === 0) {
      // Foguete: contato com o cenário ou com um inimigo no segmento deste tick.
      if (step > 1e-9) {
        const dx = vx / speed;
        const dy = vy / speed;
        const dz = vz / speed;
        raycastGrid(ctx.grid, ctx.blocks, x, y, z, dx, dy, dz, step, BLOCK_FLAG.blocksBullets, rayHit, ctx.colliders);
        const wallT = rayHit.hit ? rayHit.distance : step;
        const target = bodyOnSegment(ctx, owner, x, y, z, dx, dy, dz, wallT);
        if (target >= 0) {
          const t = ctx.figures.bestT();
          const hx = x + dx * t;
          const hy = y + dy * t;
          const hz = z + dz * t;
          const i = ctx.damage.push(target, owner, def.damage, PART_TORSO, hitBone, def.code, hx, hy, hz);
          ctx.damage.setDirection(i, dx, dy, dz, def.killForce);
          explode(ctx, hx, hy, hz, def, owner, target);
          s.freeProjectile(p);
          continue;
        }
        if (rayHit.hit) {
          explode(
            ctx,
            rayHit.x + rayHit.normalX * SURFACE_OFFSET,
            rayHit.y + rayHit.normalY * SURFACE_OFFSET,
            rayHit.z + rayHit.normalZ * SURFACE_OFFSET,
            def,
            owner,
            -1,
          );
          s.freeProjectile(p);
          continue;
        }
      }
      s.projPosition[p3] = x + vx * dt;
      s.projPosition[p3 + 1] = y + vy * dt;
      s.projPosition[p3 + 2] = z + vz * dt;
    } else if (step > 1e-9) {
      // Granada: anda; se bater num bloco, para na superfície e reflete a velocidade com perda.
      const dx = vx / speed;
      const dy = vy / speed;
      const dz = vz / speed;
      raycastGrid(ctx.grid, ctx.blocks, x, y, z, dx, dy, dz, step, BLOCK_FLAG.blocksBullets, rayHit, ctx.colliders);
      if (rayHit.hit) {
        const nx = rayHit.normalX;
        const ny = rayHit.normalY;
        const nz = rayHit.normalZ;
        s.projPosition[p3] = rayHit.x + nx * SURFACE_OFFSET;
        s.projPosition[p3 + 1] = rayHit.y + ny * SURFACE_OFFSET;
        s.projPosition[p3 + 2] = rayHit.z + nz * SURFACE_OFFSET;
        const vn = vx * nx + vy * ny + vz * nz;
        if (vn < 0) {
          const tx = vx - vn * nx;
          const ty = vy - vn * ny;
          const tz = vz - vn * nz;
          vx = tx * BOUNCE_TANGENT - vn * BOUNCE_NORMAL * nx;
          vy = ty * BOUNCE_TANGENT - vn * BOUNCE_NORMAL * ny;
          vz = tz * BOUNCE_TANGENT - vn * BOUNCE_NORMAL * nz;
        }
        const after = Math.sqrt(vx * vx + vy * vy + vz * vz);
        // Parada no chão: zera para não tremer quicando no mesmo bloco a cada tick.
        if (after < REST_SPEED && ny > 0.7) {
          vx = 0;
          vy = 0;
          vz = 0;
        } else if (-vn > BOUNCE_EVENT_SPEED) {
          ctx.events.projectile(
            ctx.tick,
            'bounce',
            p,
            def.code,
            owner,
            s.projPosition[p3]!,
            s.projPosition[p3 + 1]!,
            s.projPosition[p3 + 2]!,
            vx,
            vy,
            vz,
          );
        }
      } else {
        s.projPosition[p3] = x + vx * dt;
        s.projPosition[p3 + 1] = y + vy * dt;
        s.projPosition[p3 + 2] = z + vz * dt;
      }
    } else if (def.projectileGravity > 0) {
      // Parada: só cai se o chão sumir embaixo (nunca no M2: o cenário é estático). Mantém o repouso.
      vy = 0;
    }
    s.projVelocity[p3] = vx;
    s.projVelocity[p3 + 1] = vy;
    s.projVelocity[p3 + 2] = vz;

    // Pavio (granada) ou fim do alcance (foguete); abaixo do plano de morte some sem explodir.
    if (s.projPosition[p3 + 1]! < ctx.killPlaneY) {
      s.freeProjectile(p);
      continue;
    }
    if (--s.projFuseTicks[p]! <= 0) {
      explode(ctx, s.projPosition[p3]!, s.projPosition[p3 + 1]!, s.projPosition[p3 + 2]!, def, owner, -1);
      s.freeProjectile(p);
    }
  }
}

/** Osso do último corpo achado por `bodyOnSegment`. */
let hitBone: FigurePart = FIGURE_BONE.torso;

/**
 * Primeiro inimigo de `owner` cujas hitboxes o segmento cruza antes de `maxT` (a distância fica em
 * `ctx.figures.bestT()`), ou -1. Quem lançou nunca é atingido pelo próprio foguete (só pela explosão).
 */
function bodyOnSegment(
  ctx: SimContext,
  owner: EntityId,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): number {
  const s = ctx.s;
  const o = s.isCurrent(owner) ? owner & 0xffff : -1;
  const figures = ctx.figures;
  figures.beginRay(ox, oy, oz, dx, dy, dz, maxT);
  let best = -1;
  for (let j = 0; j < s.count; j++) {
    if (s.alive[j] === 0 || !isBody(s.kind[j]!) || j === o) continue;
    if (o >= 0 && !hostile(ctx, o, j)) continue;
    const fj = s.flags[j]!;
    if ((fj & F.dead) !== 0) continue;
    const bone = figures.testEntity(s, j, figurePostureOf(fj, weaponGrip(s.weapon[j]!), s.kind[j]!), ctx.tick);
    if (bone >= 0) {
      best = j;
      hitBone = bone as FigurePart;
    }
  }
  return best;
}

/**
 * Explosão da arma `def` em (x, y, z) lançada por `owner`: dano em área em todo corpo inimigo (e em quem lançou, com
 * `selfDamageMul`) com linha de visão, menos `direct` (o alvo do acerto direto, que já levou `damage`). Emite
 * `explosion`.
 */
export function explode(
  ctx: SimContext,
  x: number,
  y: number,
  z: number,
  def: WeaponDef,
  owner: EntityId,
  direct: number,
): void {
  const s = ctx.s;
  const radius = def.blastRadiusM;
  const o = s.isCurrent(owner) ? owner & 0xffff : -1;
  ctx.events.explosion(ctx.tick, owner, def.code, x, y, z, radius);
  if (radius <= 0) return;
  for (let j = 0; j < s.count; j++) {
    if (s.alive[j] === 0 || !isBody(s.kind[j]!) || j === direct) continue;
    const fj = s.flags[j]!;
    if ((fj & F.dead) !== 0) continue;
    const self = j === o;
    if (!self && o >= 0 && !hostile(ctx, o, j)) continue;
    // Ponto mais perto da AABB do corpo.
    const j3 = j * 3;
    const half = METRICS.aabbWidth / 2;
    const h = (fj & F.crouching) !== 0 ? METRICS.aabbCrouchHeight : METRICS.aabbHeight;
    const bx = s.position[j3]!;
    const by = s.position[j3 + 1]!;
    const bz = s.position[j3 + 2]!;
    const cx = x < bx - half ? bx - half : x > bx + half ? bx + half : x;
    const cy = y < by ? by : y > by + h ? by + h : y;
    const cz = z < bz - half ? bz - half : z > bz + half ? bz + half : z;
    let dx = cx - x;
    let dy = cy - y;
    let dz = cz - z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist >= radius) continue;
    // Linha de visão do centro até o ponto (encostado no corpo, distância 0, sempre vale).
    if (dist > 1e-6) {
      dx /= dist;
      dy /= dist;
      dz /= dist;
      if (raycastGrid(ctx.grid, ctx.blocks, x, y, z, dx, dy, dz, dist, BLOCK_FLAG.blocksBullets, losHit, ctx.colliders))
        continue;
    } else {
      // Dentro da caixa: empurra para longe do centro do corpo (ou para cima).
      dx = bx - x;
      dy = 0;
      dz = bz - z;
      const l = Math.sqrt(dx * dx + dz * dz);
      if (l > 1e-6) {
        dx /= l;
        dz /= l;
      } else {
        dx = 0;
        dy = 1;
        dz = 0;
      }
    }
    const falloff = 1 - dist / radius;
    const amount = def.blastDamage * falloff * (self ? def.selfDamageMul : 1);
    if (amount <= 0) continue;
    const i = ctx.damage.push(j, owner, amount, PART_TORSO, FIGURE_BONE.torso, def.code, cx, cy, cz);
    ctx.damage.setDirection(i, dx, dy, dz, BLAST_MIN_FORCE + def.killForce * falloff);
  }
}
