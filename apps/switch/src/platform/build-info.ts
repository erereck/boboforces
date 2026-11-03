import type { NxFs } from './nx.ts';

/**
 * Manifesto que `scripts/build.ts` grava em `romfs/manifest.json`: versão, codinome e commit do build, mais o sha256
 * de cada arquivo do RomFS (rastreia exatamente o que foi empacotado, como o `source-manifest.json` do MMM).
 */
export interface BuildManifest {
  readonly name: 'BoboForces';
  readonly version: string;
  readonly codename: string;
  readonly platform: 'switch';
  readonly online: false;
  /** `git rev-parse HEAD`, ou `null` fora de um repositório com commit. */
  readonly commit: string | null;
  /** Havia mudanças não commitadas no build (`null` quando não se sabe). */
  readonly dirty: boolean | null;
  /** Caminho no RomFS → sha256 em hexadecimal. */
  readonly files: Readonly<Record<string, string>>;
}

export const BUILD_MANIFEST_PATH = 'romfs:/manifest.json';

export function readBuildManifest(fs: Pick<NxFs, 'readFileSync'>): BuildManifest | null {
  try {
    const bytes = fs.readFileSync(BUILD_MANIFEST_PATH);
    if (!bytes) return null;
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as BuildManifest).version !== 'string') return null;
    return parsed as BuildManifest;
  } catch {
    return null;
  }
}

/** `0.0.1 "Primeiro Bloco" (abc1234+)`, para a primeira linha do runtime.log. */
export function describeBuild(manifest: BuildManifest | null): string {
  if (!manifest) return '(sem manifesto do build)';
  const commit = manifest.commit ? manifest.commit.slice(0, 7) : 'sem commit';
  return `${manifest.version} "${manifest.codename}" (${commit}${manifest.dirty ? '+' : ''})`;
}
