import { WEAPON_CODE, weaponDef } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import { classProblem, formatWeaponReport, runWeaponDuels, WEAPON_TABLE, weaponTheory } from './weapons.ts';

describe('robô por arma (M10)', () => {
  it('toda arma de fogo na faixa da classe dela (TTK sem errar, GDD §4.3)', () => {
    for (const w of WEAPON_TABLE) expect(classProblem(w.cls, weaponTheory(weaponDef(w.code)!)), w.name).toBeNull();
    // As referências do GDD: fuzil 0,30 s, SMG 0,28 s, pistola 0,45 s.
    expect(weaponTheory(weaponDef(WEAPON_CODE.rifle)!).ttkBodyS).toBeCloseTo(0.3, 5);
    expect(weaponTheory(weaponDef(WEAPON_CODE.pistol)!).ttkBodyS).toBeCloseTo(0.45, 5);
    // A besta: o pente de 1 faz da recarga o intervalo.
    expect(weaponTheory(weaponDef(WEAPON_CODE.crossbow)!).intervalS).toBeCloseTo(1.5, 5);
  });

  it('as 5 armas novas decidem os duelos com ela (os bots matam com cada uma)', () => {
    const codes = [
      WEAPON_CODE.dmr,
      WEAPON_CODE.revolver,
      WEAPON_CODE.autoShotgun,
      WEAPON_CODE.crossbow,
      WEAPON_CODE.grenadeLauncher,
    ];
    const r = runWeaponDuels({ roundsPerWeapon: 4, seed: 42, codes });
    expect(r.rows.map((x) => x.code).sort()).toEqual([...codes].sort());
    for (const row of r.rows) {
      expect(row.decided, row.name).toBeGreaterThan(0);
      expect(row.ttkCount, row.name).toBeGreaterThan(0);
    }
    expect(r.ok).toBe(true);
    expect(formatWeaponReport(r)).toContain('Pinpoint');
  }, 60_000);
});
