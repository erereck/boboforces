import type { BenchConfig } from '@boboforces/game';
import type { RendererOptions } from '@boboforces/render';

/** O que a criação do renderer lê da plataforma (o contexto WebGL2 é dela, tecnico.md §6.10). */
export interface SurfaceChoices {
  readonly antialias: boolean;
  readonly maxPixelRatio: number;
}

/**
 * Opções de criação do renderer: antialias e teto de DPR seguem a plataforma (o render nunca encolhe o buffer de
 * novo) e, no bench, entram as rotas do Teste Zero, fixas na criação (`atlas=1` → atlas; `float=1` → atributos em
 * float). Fora do bench ficam os padrões do render (array e inteiros).
 */
export function rendererOptionsFor(surface: SurfaceChoices, bench: BenchConfig | null): RendererOptions {
  const base: RendererOptions = { antialias: surface.antialias, maxPixelRatio: surface.maxPixelRatio };
  return bench ? { ...base, textureMode: bench.textureMode, vertexAttributes: bench.vertexAttributes } : base;
}

/**
 * A URL pede o bench? Teste barato que fica no chunk de entrada: só olha a chave `bench` (qualquer caixa); quem
 * valida é o `readBenchFromUrl`, já dentro do chunk do bench, que só é baixado quando isto der `true`.
 */
export function urlAsksForBench(search: string): boolean {
  return /(?:^\??|&)bench(?:[=&]|$)/i.test(search);
}
