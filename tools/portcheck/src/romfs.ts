/**
 * Conferência do RomFS do Switch (M1): todo asset do `runtime-assets.json` está em `assets/<lógico>`, nenhum é o
 * PROVISÓRIO da etapa de contratos (o runtime recusa com "rode npm run assets"), e o tamanho total cabe no orçamento
 * (tecnico.md §16.4: romfs até 60 MB; o runtime do nx.js soma ~56 MB ao NRO à parte).
 */
import { inflateRawSync } from 'node:zlib';

/** Teto do RomFS do jogo (main.js + sourcemap + assets + manifesto). */
export const ROMFS_BUDGET_BYTES = 60 * 1024 * 1024;
/** Quantos arquivos maiores o relatório lista. */
const LARGEST = 5;

export interface RomfsEntry {
  readonly path: string;
  readonly bytes: number;
}

export interface RomfsReport {
  readonly files: number;
  readonly totalBytes: number;
  readonly mainBytes: number;
  readonly assetBytes: number;
  /** Caminhos lógicos do `runtime-assets.json` que faltam em `assets/`. */
  readonly missing: readonly string[];
  /** Assets provisórios (`caminho: motivo`). */
  readonly placeholders: readonly string[];
  readonly largest: readonly RomfsEntry[];
  readonly overBudget: boolean;
  readonly budgetBytes: number;
}

/** Motivo de o arquivo parecer o provisório da etapa de contratos, ou `null`. */
export function placeholderReason(path: string, bytes: Uint8Array): string | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'json') {
    try {
      const doc = JSON.parse(new TextDecoder().decode(bytes)) as { placeholder?: unknown };
      return doc && typeof doc === 'object' && doc.placeholder === true ? 'JSON com "placeholder": true' : null;
    } catch {
      return 'JSON inválido';
    }
  }
  if (ext === 'png') {
    if (bytes.length < 24) return 'PNG truncado';
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const w = view.getUint32(16);
    const h = view.getUint32(20);
    return w === 1 && h === 1 ? 'PNG 1×1' : null;
  }
  if (ext === 'mp3') {
    let zeros = 0;
    for (const b of bytes) if (b === 0) zeros++;
    // O silêncio do LAME é ~94% de byte zero; som de verdade fica abaixo de 15%.
    return bytes.length === 0 || zeros / bytes.length > 0.5 ? 'MP3 de silêncio' : null;
  }
  if (ext === 'bfmap' || ext === 'bfmodel') {
    try {
      const text = new TextDecoder('latin1').decode(inflateRawSync(bytes));
      if (text.includes('PROVISORIO')) return 'binário provisório (versão 0)';
    } catch {
      // binário de verdade (o cabeçalho próprio não é deflate cru)
    }
    return null;
  }
  return null;
}

/**
 * Confere o RomFS em memória (caminho relativo com `/` → bytes) contra os caminhos lógicos do
 * `runtime-assets.json` (`files`).
 */
export function checkRomfs(
  romfs: ReadonlyMap<string, Uint8Array>,
  logicalAssets: readonly string[],
  budgetBytes: number = ROMFS_BUDGET_BYTES,
): RomfsReport {
  let total = 0;
  let assetBytes = 0;
  const entries: RomfsEntry[] = [];
  for (const [path, bytes] of romfs) {
    total += bytes.length;
    if (path.startsWith('assets/')) assetBytes += bytes.length;
    entries.push({ path, bytes: bytes.length });
  }
  const missing: string[] = [];
  const placeholders: string[] = [];
  for (const logical of logicalAssets) {
    const bytes = romfs.get(`assets/${logical}`);
    if (!bytes) {
      missing.push(logical);
      continue;
    }
    const reason = placeholderReason(logical, bytes);
    if (reason) placeholders.push(`${logical}: ${reason}`);
  }
  entries.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return {
    files: romfs.size,
    totalBytes: total,
    mainBytes: romfs.get('main.js')?.length ?? 0,
    assetBytes,
    missing,
    placeholders,
    largest: entries.slice(0, LARGEST),
    overBudget: total > budgetBytes,
    budgetBytes,
  };
}

const mb = (n: number): string => `${(n / 1048576).toFixed(2)} MB`;

/** Linhas do relatório (pt-BR). */
export function formatRomfs(r: RomfsReport): string[] {
  const lines = [
    `RomFS: ${r.files} arquivo(s), ${mb(r.totalBytes)} de ${mb(r.budgetBytes)}` +
      ` (main.js ${mb(r.mainBytes)}, assets ${mb(r.assetBytes)})${r.overBudget ? ' ACIMA DO ORÇAMENTO' : ''}`,
    `  maiores: ${r.largest.map((e) => `${e.path} ${mb(e.bytes)}`).join(' · ')}`,
  ];
  for (const m of r.missing) lines.push(`  falta no RomFS: assets/${m} (runtime-assets.json)`);
  for (const p of r.placeholders) lines.push(`  provisório (rode npm run assets): ${p}`);
  return lines;
}
