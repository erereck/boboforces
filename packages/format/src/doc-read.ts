import { isPlainObject, issue, type IssueCode, type ValidationIssue } from './validation.ts';

/**
 * M2 (fase 4b): leitura tolerante dos documentos do jogador (`settings@1`, `stats@1`, `backup@1`): cada campo que
 * falta cai no padrão; tipo errado cai no padrão com o aviso `invalid`; número fora da faixa é limitado com o aviso
 * `clamped`. O documento nunca é recusado por um campo: só por não ser objeto ou ser de outro tipo (tecnico.md §14.2).
 */
export class DocReader {
  readonly warnings: ValidationIssue[] = [];
  private readonly invalid: IssueCode;
  private readonly clamped: IssueCode;

  constructor(invalid: IssueCode, clamped: IssueCode) {
    this.invalid = invalid;
    this.clamped = clamped;
  }

  warn(path: string, code: IssueCode, detail?: string): void {
    this.warnings.push(issue(path, code, detail));
  }

  obj(src: Record<string, unknown>, key: string, path: string): Record<string, unknown> {
    const v = src[key];
    if (v === undefined) return {};
    if (isPlainObject(v)) return v;
    this.warn(path, this.invalid);
    return {};
  }

  num(src: Record<string, unknown>, key: string, path: string, fallback: number, min: number, max: number): number {
    const v = src[key];
    if (v === undefined) return fallback;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.warn(path, this.invalid);
      return fallback;
    }
    const c = v < min ? min : v > max ? max : v;
    if (c !== v) this.warn(path, this.clamped, `${v} → ${c}`);
    return c;
  }

  /** Inteiro ≥ 0 (contadores): arredonda e limita a `max`. */
  count(src: Record<string, unknown>, key: string, path: string, max = 1e9): number {
    return Math.round(this.num(src, key, path, 0, 0, max));
  }

  bool(src: Record<string, unknown>, key: string, path: string, fallback: boolean): boolean {
    const v = src[key];
    if (v === undefined) return fallback;
    if (typeof v === 'boolean') return v;
    this.warn(path, this.invalid);
    return fallback;
  }

  pick<T extends string>(
    src: Record<string, unknown>,
    key: string,
    path: string,
    fallback: T,
    allowed: readonly T[],
  ): T {
    const v = src[key];
    if (v === undefined) return fallback;
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
    this.warn(path, this.invalid);
    return fallback;
  }

  str(src: Record<string, unknown>, key: string, path: string, fallback: string, maxLength: number): string {
    const v = src[key];
    if (v === undefined) return fallback;
    if (typeof v !== 'string') {
      this.warn(path, this.invalid);
      return fallback;
    }
    if (v.length <= maxLength) return v;
    this.warn(path, this.clamped, `${v.length} → ${maxLength} caracteres`);
    return v.slice(0, maxLength);
  }

  /** Lista de textos curtos (até `max` itens de até `maxLength`): itens de outro tipo saem com aviso. */
  strings(src: Record<string, unknown>, key: string, path: string, max: number, maxLength: number): string[] {
    const v = src[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      this.warn(path, this.invalid);
      return [];
    }
    const out: string[] = [];
    for (const item of v) {
      if (typeof item !== 'string' || item.length > maxLength) {
        this.warn(path, this.invalid);
        continue;
      }
      if (out.length === max) {
        this.warn(path, this.clamped, `${v.length} → ${max} itens`);
        break;
      }
      out.push(item);
    }
    return out;
  }
}
