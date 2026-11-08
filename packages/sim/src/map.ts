import type { MapMarkers } from '@boboforces/format';
import type { NavGrid } from '@boboforces/nav';
import { assert } from '@boboforces/shared';
import type { BlockRegistry, StaticColliders, WorldGrid } from '@boboforces/world';
import { MAX_TEAMS } from './constants.ts';
import type { SimMap, SpawnPoint } from './sim.ts';

/** O que sai do loading de um `.bfmap` (o `game` monta a grade, o registro, as props e a navegação). */
export interface SimMapSource {
  readonly grid: WorldGrid;
  readonly blocks: BlockRegistry;
  /** Marcadores do `.bfmap` (`MapDocument.markers`): spawns e área jogável. */
  readonly markers: Pick<MapMarkers, 'spawns' | 'playArea'>;
  readonly colliders?: StaticColliders | null;
  readonly nav?: NavGrid | null;
}

/** Spawns da sim a partir dos marcadores do mapa (metros nos pés, yaw em rad, `team` -1 = qualquer time). */
export function spawnPointsFromMarkers(markers: Pick<MapMarkers, 'spawns'>): SpawnPoint[] {
  return markers.spawns.map((m, i) => {
    assert(
      Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.z) && Number.isFinite(m.yaw),
      `mapa: spawn ${i} com coordenada inválida`,
    );
    assert(Number.isInteger(m.team) && m.team >= -1 && m.team < MAX_TEAMS, `mapa: spawn ${i} com time inválido`);
    return { x: m.x, y: m.y, z: m.z, yaw: m.yaw, team: m.team };
  });
}

/**
 * Monta o `SimMap` da partida a partir do mapa carregado (M1: o Construto). Spawns vêm dos marcadores (TDM: os do time;
 * FFA e zumbis: todos, preferindo os de `team` -1), a área jogável vira parede invisível em X/Z e o `killPlaneY` do
 * mapa substitui o padrão (10 m abaixo do bloco mais baixo). `colliders` e `nav` só passam adiante.
 */
export function simMapFromMarkers(source: SimMapSource): SimMap {
  const spawns = spawnPointsFromMarkers(source.markers);
  assert(spawns.length > 0, 'mapa: nenhum spawn nos marcadores');
  const area = source.markers.playArea;
  assert(area.minX < area.maxX && area.minZ < area.maxZ, 'mapa: área jogável vazia');
  assert(Number.isFinite(area.killPlaneY), 'mapa: plano de morte inválido');
  return {
    grid: source.grid,
    blocks: source.blocks,
    spawns,
    playArea: { minX: area.minX, minZ: area.minZ, maxX: area.maxX, maxZ: area.maxZ },
    killPlaneY: area.killPlaneY,
    ...(source.colliders ? { colliders: source.colliders } : {}),
    ...(source.nav ? { nav: source.nav } : {}),
  };
}
