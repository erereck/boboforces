// Linhas `[t0] item=N …` da casca (contrato: `formatT0Line` do game, docs/TESTE_ZERO.md §7). A casca grava os itens
// 1–9 (os de GL — 4, 5, 6 e 9 — como teste mínimo antes do three, com `fonte=casca`, e o 3 na criação do renderer) e
// 17–21. O game grava só os itens 10–16, no fim de cada bench; no bench, a rota de textura e de atributos aparece na
// linha `sistema=` do relatório e no item 11, não como item 4/5 de novo.
import { formatT0Line, type T0Item, type T0Status } from '@boboforces/game';

export type T0Fields = Record<string, string | number | boolean>;

export type T0Logger = (item: T0Item, status: T0Status, fields?: T0Fields) => void;

/** Logger que nunca lança (uma chave mal escrita vira linha de erro em vez de derrubar o boot). */
export function createT0Logger(log: (line: string) => void): T0Logger {
  return (item, status, fields = {}) => {
    try {
      log(formatT0Line(item, status, fields));
    } catch (error) {
      log(`[t0] item=${item} status=falha erro="linha inválida: ${String((error as Error)?.message ?? error)}"`);
    }
  };
}

/** Milissegundos com 2 casas (sem Intl). */
export const ms2 = (v: number): number => Math.round(v * 100) / 100;

/** `0x1f` (bits de styleSet/deviceType); -1 fica -1. */
export const hex = (v: number): string => (v < 0 ? '-1' : `0x${v.toString(16)}`);

/** Texto curto de um erro, para o campo `erro=`. */
export function errorText(error: unknown): string {
  const m = (error as { message?: unknown } | null)?.message;
  return (typeof m === 'string' ? m : String(error)).slice(0, 160);
}

/** Tira o número de série do `id` do controle (o nx.js põe "Nome (SERIAL)"): o log nunca guarda serial. */
export function controllerModel(id: string): string {
  return id.replace(/\s*\([^)]*\)\s*$/, '').trim() || 'desconhecido';
}
